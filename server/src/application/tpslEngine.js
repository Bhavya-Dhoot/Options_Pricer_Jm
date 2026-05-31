import mongoose from 'mongoose';
import Trade from '../domain/Trade.js';
import User from '../domain/User.js';
import { estimateMargin } from '../domain/marginCalculator.js';
import { setHasTPSLTrades } from './priceCache.js';

/**
 * TP/SL Auto-Exit Engine
 * Called by the background price cache loop after every successful data fetch.
 * Checks all OPEN trades with targetPrice or stopLoss set, and auto-exits
 * any trade whose TP or SL has been triggered based on live prices.
 */

const parseExpiry = (expiryStr) => {
  if (!expiryStr) return 0;
  try {
    const day = parseInt(expiryStr.slice(0, 2), 10);
    const monthStr = expiryStr.slice(3, 6);
    const year = parseInt(expiryStr.slice(7), 10);
    const months = { Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5, Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11 };
    const month = months[monthStr];
    if (month === undefined) return 0;
    return new Date(year, month, day).getTime();
  } catch (e) {
    return 0;
  }
};

// Debounce: prevent checking more often than every 2 seconds
let lastCheckTime = 0;

/**
 * Gets the current live LTP for a trade from the priceCache.
 * Returns null if data is unavailable.
 */
function getLTPForTrade(trade, priceCache) {
  const cached = priceCache[trade.symbol];
  if (!cached || !cached.data) return null;
  const data = cached.data;

  if (trade.type === 'equity') {
    return data.spot || null;
  } else if (trade.type === 'future') {
    return data.futurePrices?.[trade.expiry] || null;
  } else if (trade.type === 'underlying') {
    return data.spot || null;
  } else {
    const chain = data.byExpiry?.[trade.expiry];
    if (!chain) return null;
    const strikeData = chain.find(s => (s.strikePrice || s.strike) === trade.strike);
    if (!strikeData) return null;
    const optData = trade.type === 'call' ? strikeData.call : strikeData.put;
    if (!optData) return null;
    // Use bid for closing buy positions, ask for closing sell positions
    return trade.action === 'buy' ? (optData.bidPrice || optData.ltp) : (optData.askPrice || optData.ltp);
  }
}

/**
 * Check if TP or SL is triggered for a given trade and LTP.
 * Returns 'TARGET_HIT' | 'STOPLOSS_HIT' | null
 */
function checkTrigger(trade, ltp) {
  if (trade.action === 'buy') {
    // Buy: TP triggers when LTP >= targetPrice, SL triggers when LTP <= stopLoss
    if (trade.targetPrice != null && ltp >= trade.targetPrice) return 'TARGET_HIT';
    if (trade.stopLoss != null && ltp <= trade.stopLoss) return 'STOPLOSS_HIT';
  } else {
    // Sell: TP triggers when LTP <= targetPrice, SL triggers when LTP >= stopLoss
    if (trade.targetPrice != null && ltp <= trade.targetPrice) return 'TARGET_HIT';
    if (trade.stopLoss != null && ltp >= trade.stopLoss) return 'STOPLOSS_HIT';
  }
  return null;
}

/**
 * Auto-exit a single trade atomically using ACID transactions.
 * Reuses the same pattern as manual exitTrade.
 */
async function autoExitTrade(trade, exitPrice, exitReason) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Re-fetch trade within session to ensure ACID consistency
    const freshTrade = await Trade.findById(trade._id).session(session);
    if (!freshTrade || freshTrade.status !== 'OPEN') {
      await session.abortTransaction();
      return; // Already closed by another process
    }

    const direction = freshTrade.action === 'buy' ? 1 : -1;
    const lotSize = freshTrade.lotSize || 25;
    const pnl = direction * (exitPrice - freshTrade.entryPrice) * freshTrade.qty * lotSize;

    if (isNaN(pnl)) {
      await session.abortTransaction();
      console.error(`[TPSL] NaN PnL for trade ${trade._id}, skipping auto-exit.`);
      return;
    }

    let exitCashflow = 0;
    if (freshTrade.type !== 'future') {
      exitCashflow = (freshTrade.action === 'buy' ? 1 : -1) * exitPrice * freshTrade.qty * lotSize;
    } else {
      exitCashflow = pnl + (freshTrade.marginBlocked || 0);
    }

    // Update user capital
    await User.updateOne(
      { _id: freshTrade.user },
      { $inc: { realizedPnL: pnl, virtualCapital: exitCashflow } },
      { session }
    );

    // Close the trade
    await Trade.findOneAndUpdate(
      { _id: freshTrade._id, status: 'OPEN' },
      { status: 'CLOSED', exitPrice, exitTime: Date.now(), exitReason, $inc: { realizedPnL: pnl } },
      { session }
    );

    await session.commitTransaction();
    console.log(`[TPSL] Auto-exited trade ${trade._id} | ${exitReason} | Exit: ₹${exitPrice.toFixed(2)} | PnL: ₹${pnl.toFixed(2)}`);
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    console.error(`[TPSL] Auto-exit failed for trade ${trade._id}:`, error.message);
  } finally {
    session.endSession();
  }
}

/**
 * Main entry point: called by priceCache after every background data fetch.
 * Queries all OPEN trades with TP/SL set, checks live prices, and auto-exits.
 */
export async function checkTPSL(priceCache) {
  const now = Date.now();
  // Debounce: don't check more often than every 2 seconds
  if (now - lastCheckTime < 2000) return;
  lastCheckTime = now;

  try {
    // Only fetch trades that actually have TP or SL set (indexed query)
    const trades = await Trade.find({
      status: 'OPEN',
      $or: [
        { targetPrice: { $ne: null } },
        { stopLoss: { $ne: null } }
      ]
    }).lean();

    if (trades.length === 0) {
      setHasTPSLTrades(false);
      return;
    }
    setHasTPSLTrades(true);

    for (const trade of trades) {
      const ltp = getLTPForTrade(trade, priceCache);
      if (ltp == null || ltp <= 0) continue; // Skip if no live data

      const trigger = checkTrigger(trade, ltp);
      if (trigger) {
        await autoExitTrade(trade, ltp, trigger);
      }
    }
  } catch (error) {
    console.error(`[TPSL] Engine error:`, error.message);
  }
}
