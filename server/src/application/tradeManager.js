import mongoose from 'mongoose';
import Trade from '../domain/Trade.js';
import User from '../domain/User.js';
import { getLatestPrice, registerSymbol, forceFetchLatestPrice } from './priceCache.js';
import { getLotSize } from '../../scripMaster.js';
import { estimateMargin } from '../domain/marginCalculator.js';

// In-Memory Mutex Lock for User Threads
const userLocks = new Map();

async function acquireLock(userId) {
  const uid = userId.toString();
  if (!userLocks.has(uid)) {
    userLocks.set(uid, Promise.resolve());
  }
  let release;
  const nextLock = new Promise(resolve => release = resolve);
  const currentLock = userLocks.get(uid);
  userLocks.set(uid, currentLock.then(() => nextLock));
  await currentLock;
  
  // Return release function, also garbage collect the map if no waiters
  return () => {
    release();
    if (userLocks.get(uid) === nextLock) {
      userLocks.delete(uid);
    }
  };
}

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

export const placeTrade = async (req, res) => {
  const { symbol, type, strike, expiry, action, orderType, limitPrice, qty } = req.body;
  
  if (!qty || !Number.isInteger(qty) || qty <= 0) {
    return res.status(400).json({ error: 'Quantity must be a positive integer.' });
  }

  const releaseLock = await acquireLock(req.user._id);

  try {
    const user = await User.findById(req.user._id);
    const verifiedLotSize = getLotSize(symbol);
    
    // Server-Side Price Verification
    registerSymbol(symbol); // Ensure symbol is tracked in background
    let verifiedEntryPrice = 0;
    
    if (orderType === 'market') {
      let liveData = getLatestPrice(symbol);
      
      // Force an immediate API fetch if the cache is older than 500ms (slippage protection)
      if (!liveData || !liveData.timestamp || Date.now() - liveData.timestamp > 500) {
        try {
          liveData = await forceFetchLatestPrice(symbol);
        } catch (e) {
          console.warn(`[TradeManager] Force fetch failed for ${symbol}, using cache fallback.`, e.message);
        }
      }

      if (!liveData || !liveData.data) {
        return res.status(400).json({ error: 'Market data unavailable, try again in 1 second.' });
      }

      if (type === 'future') {
        const futPrice = liveData.data.futurePrices?.[expiry];
        if (!futPrice) {
          return res.status(400).json({ error: 'Invalid future expiry or pricing unavailable.' });
        }
        verifiedEntryPrice = futPrice;
      } else if (type === 'underlying') {
        verifiedEntryPrice = liveData.data.spot;
      } else {
        const chain = liveData.data.byExpiry?.[expiry];
        if (!chain) return res.status(400).json({ error: 'Invalid expiry for options.' });
        
        const strikeData = chain.find(s => (s.strikePrice || s.strike) === strike);
        if (!strikeData) return res.status(400).json({ error: 'Invalid strike price.' });
        
        const optData = type === 'call' ? strikeData.call : strikeData.put;
        if (!optData) return res.status(400).json({ error: 'Option data unavailable.' });
        
        // Slippage / Bid-Ask
        // If Buy, we pay the Ask. If Sell, we get the Bid.
        verifiedEntryPrice = action === 'buy' ? (optData.askPrice || optData.ltp) : (optData.bidPrice || optData.ltp);
      }
    } else {
      verifiedEntryPrice = limitPrice;
    }

    // Calculate exact margin required for this trade
    let estimatedMargin = 0;
    if (action === 'buy') {
      estimatedMargin = verifiedEntryPrice * qty * verifiedLotSize;
    } else {
      const liveData = getLatestPrice(symbol);
      const spot = liveData?.data?.spot || verifiedEntryPrice;
      estimatedMargin = spot * verifiedLotSize * 0.15 * qty; // Fix: 15% of underlying contract value
    }

    // Dynamic Margin Check using holistic margin calculator for portfolio
    const openTrades = await Trade.find({ user: user._id, status: 'OPEN' });
    const allPortfolioLegs = openTrades.map(t => ({
      type: t.type,
      action: t.action,
      qty: t.qty,
      lotSize: t.lotSize,
      strike: t.strike,
      expiry: t.expiry,
      premium: t.entryPrice
    }));
    
    // Check holistic margin if this new trade is added
    const newLeg = { type, action, qty, lotSize: verifiedLotSize, strike, expiry, premium: verifiedEntryPrice };
    const combinedLegs = [...allPortfolioLegs, newLeg];
    
    const liveDataForSpot = getLatestPrice(symbol);
    const spotForMargin = liveDataForSpot?.data?.spot || verifiedEntryPrice;
    
    const newMarginEst = estimateMargin(combinedLegs, spotForMargin, symbol);
    const newTotalMargin = newMarginEst.totalMarginRequired;

    if (newTotalMargin > user.virtualCapital) {
      return res.status(400).json({ error: `Insufficient margin. Required: ₹${newTotalMargin.toFixed(0)}, Available: ₹${user.virtualCapital.toFixed(0)}` });
    }
    
    const trade = await Trade.create({
      user: req.user._id,
      symbol,
      type,
      strike,
      expiry,
      action,
      orderType,
      limitPrice,
      qty,
      lotSize: verifiedLotSize,
      marginBlocked: estimatedMargin,
      entryPrice: orderType === 'market' ? verifiedEntryPrice : null,
      entryTime: orderType === 'market' ? Date.now() : null,
      status: orderType === 'market' ? 'OPEN' : 'PENDING'
    });

    res.status(201).json(trade);
  } catch (error) {
    res.status(400).json({ error: error.message });
  } finally {
    releaseLock();
  }
};

export const placeBatchTrades = async (req, res) => {
  const { legs, symbol } = req.body;
  if (!legs || !Array.isArray(legs) || legs.length === 0) {
    return res.status(400).json({ error: 'Valid legs array required.' });
  }
  if (legs.length > 20) {
    return res.status(400).json({ error: 'Maximum of 20 legs allowed per batch trade.' });
  }

  const releaseLock = await acquireLock(req.user._id);

  try {
    const user = await User.findById(req.user._id);
    const verifiedLegs = [];
    const baseSymbol = symbol || legs[0].symbol || 'NIFTY'; 
    registerSymbol(baseSymbol);
    
    let liveData = getLatestPrice(baseSymbol);
    
    // Force an immediate API fetch if the cache is older than 500ms (slippage protection)
    if (!liveData || !liveData.timestamp || Date.now() - liveData.timestamp > 500) {
      try {
        liveData = await forceFetchLatestPrice(baseSymbol);
      } catch (e) {
        console.warn(`[TradeManager] Force fetch failed for ${baseSymbol}, using cache fallback.`, e.message);
      }
    }
    
    if (!liveData || !liveData.data) {
      return res.status(400).json({ error: 'Market data unavailable, try again in 1 second.' });
    }
    const spot = liveData.data.spot;

    for (const leg of legs) {
      if (!leg.qty || !Number.isInteger(leg.qty) || leg.qty <= 0) {
        return res.status(400).json({ error: 'Quantity must be a positive integer.' });
      }
      
      const verifiedLotSize = getLotSize(leg.symbol || baseSymbol);
      let verifiedEntryPrice = 0;
      
      if (leg.type === 'future') {
        const futPrice = liveData.data.futurePrices?.[leg.expiry];
        if (!futPrice) return res.status(400).json({ error: 'Future pricing unavailable.' });
        verifiedEntryPrice = futPrice;
      } else if (leg.type === 'underlying') {
        verifiedEntryPrice = liveData.data.spot;
      } else {
        const chain = liveData.data.byExpiry?.[leg.expiry];
        if (!chain) return res.status(400).json({ error: 'Invalid expiry.' });
        const strikeData = chain.find(s => (s.strikePrice || s.strike) === leg.strike);
        if (!strikeData) return res.status(400).json({ error: 'Invalid strike.' });
        const optData = leg.type === 'call' ? strikeData.call : strikeData.put;
        if (!optData) return res.status(400).json({ error: 'Option data unavailable.' });
        verifiedEntryPrice = leg.action === 'buy' ? (optData.askPrice || optData.ltp) : (optData.bidPrice || optData.ltp);
      }
      
      verifiedLegs.push({
        ...leg,
        lotSize: verifiedLotSize,
        premium: verifiedEntryPrice,
        entryPrice: verifiedEntryPrice
      });
    }

    // Dynamic Margin Check using holistic margin calculator for portfolio
    const openTrades = await Trade.find({ user: user._id, status: 'OPEN' });
    const allPortfolioLegs = openTrades.map(t => ({
      type: t.type,
      action: t.action,
      qty: t.qty,
      lotSize: t.lotSize,
      strike: t.strike,
      expiry: t.expiry,
      premium: t.entryPrice
    }));
    
    const combinedLegs = [...allPortfolioLegs, ...verifiedLegs];
    const newMarginEst = estimateMargin(combinedLegs, spot, symbol);
    const newTotalMargin = newMarginEst.totalMarginRequired;

    if (newTotalMargin > user.virtualCapital) {
      return res.status(400).json({ error: `Insufficient margin. Required: ₹${newTotalMargin.toFixed(0)}, Available: ₹${user.virtualCapital.toFixed(0)}` });
    }
    
    // Create all trades atomically
    const newTrades = [];
    for (const leg of verifiedLegs) {
      const trade = await Trade.create({
        user: req.user._id,
        symbol: leg.symbol || symbol,
        type: leg.type,
        strike: leg.strike,
        expiry: leg.expiry,
        action: leg.action,
        orderType: 'market',
        qty: leg.qty,
        lotSize: leg.lotSize,
        marginBlocked: leg.action === 'buy' ? (leg.entryPrice * leg.qty * leg.lotSize) : 0, // Hedged margin is complex, so we assign 0 to short legs since we evaluate portfolio holistically
        entryPrice: leg.entryPrice,
        entryTime: Date.now(),
        status: 'OPEN'
      });
      newTrades.push(trade);
    }

    res.status(201).json(newTrades);
  } catch (error) {
    res.status(400).json({ error: error.message });
  } finally {
    releaseLock();
  }
};

export const getTrades = async (req, res) => {
  try {
    const trades = await Trade.find({ user: req.user._id }).sort({ createdAt: -1 });
    // Register active symbols to ensure they are tracked
    trades.forEach(t => {
      if (t.status === 'OPEN') registerSymbol(t.symbol);
    });
    res.json(trades);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const getLivePrices = async (req, res) => {
  try {
    // This returns the fast-cache
    const symbols = req.query.symbols ? req.query.symbols.split(',') : [];
    const isPriority = req.query.priority === 'true';
    const prices = {};
    for (const sym of symbols) {
      registerSymbol(sym, isPriority); // Track symbol and its priority status
      const cache = getLatestPrice(sym);
      if (cache) {
        prices[sym] = cache.data;
      }
    }
    res.json(prices);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const exitTrade = async (req, res) => {
  const { tradeId, exitQty, exitPrice } = req.body;
  
  const releaseLock = await acquireLock(req.user._id);
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const trade = await Trade.findById(tradeId);
    if (!trade) { await session.abortTransaction(); return res.status(404).json({ error: 'Trade not found' }); }
    if (trade.user.toString() !== req.user._id.toString()) { await session.abortTransaction(); return res.status(401).json({ error: 'Unauthorized' }); }
    if (trade.status !== 'OPEN') { await session.abortTransaction(); return res.status(400).json({ error: 'Trade is not open' }); }
    
    const parsedExitQty = Number(exitQty);
    if (isNaN(parsedExitQty) || parsedExitQty <= 0) { await session.abortTransaction(); return res.status(400).json({ error: 'Invalid exit quantity' }); }
    if (parsedExitQty > trade.qty) { await session.abortTransaction(); return res.status(400).json({ error: 'Exit qty exceeds open qty' }); }
    if (parsedExitQty !== trade.qty) { await session.abortTransaction(); return res.status(400).json({ error: 'Partial exits are not supported in this version. Must exit full quantity.' }); }

    // Server-Side Verification of Exit Price
    let verifiedExitPrice = 0;
    const liveData = getLatestPrice(trade.symbol);
    
    if (!liveData || !liveData.data) {
      await session.abortTransaction();
      return res.status(400).json({ error: 'Market data temporarily unavailable. Please try exiting again.' });
    }

    if (trade.type === 'future') {
      const futPrice = liveData.data.futurePrices?.[trade.expiry];
      if (!futPrice) { await session.abortTransaction(); return res.status(400).json({ error: 'Market data unavailable for this future expiry.' }); }
      verifiedExitPrice = futPrice;
    } else if (trade.type === 'underlying') {
      verifiedExitPrice = liveData.data.spot;
    } else {
      const chain = liveData.data.byExpiry?.[trade.expiry];
      if (!chain) {
        const expiryTime = parseExpiry(trade.expiry);
        if (expiryTime && Date.now() > expiryTime + 86400000) {
          const spot = liveData.data.spot;
          verifiedExitPrice = trade.type === 'call' ? Math.max(spot - trade.strike, 0) : Math.max(trade.strike - spot, 0);
        } else {
          await session.abortTransaction();
          return res.status(400).json({ error: 'Market data unavailable for this option expiry.' });
        }
      } else {
        const strikeData = chain.find(s => (s.strikePrice || s.strike) === trade.strike);
        if (!strikeData) { await session.abortTransaction(); return res.status(400).json({ error: 'Market data unavailable for this strike.' }); }
      
        const optData = trade.type === 'call' ? strikeData.call : strikeData.put;
        if (!optData) { await session.abortTransaction(); return res.status(400).json({ error: 'Market data unavailable for this option.' }); }
      
        verifiedExitPrice = trade.action === 'buy' ? (optData.bidPrice || optData.ltp) : (optData.askPrice || optData.ltp);
      }
    }

    // Calculate PnL for this exit
    const direction = trade.action === 'buy' ? 1 : -1;
    let lotSize = trade.lotSize;
    if (!lotSize) {
      if (trade.symbol === 'BANKNIFTY') lotSize = 15;
      else if (trade.symbol === 'FINNIFTY') lotSize = 40;
      else if (trade.symbol === 'MIDCPNIFTY') lotSize = 75;
      else if (trade.symbol === 'SENSEX') lotSize = 10;
      else if (trade.symbol === 'BANKEX') lotSize = 15;
      else lotSize = 25;
    }
    const pnl = direction * (verifiedExitPrice - trade.entryPrice) * parsedExitQty * lotSize;
    
    // Safety check to prevent NaN propagation to MongoDB
    if (isNaN(pnl)) { await session.abortTransaction(); return res.status(400).json({ error: 'Critical calculation error: Resulting PnL is NaN' }); }

    // --- MARGIN EXPLOIT PROTECTION (Simulated Exit Portfolio Validation) ---
    const user = await User.findById(req.user._id);
    if (!user) { await session.abortTransaction(); return res.status(404).json({ error: 'User not found' }); }

    const openTrades = await Trade.find({ user: user._id, status: 'OPEN', symbol: trade.symbol });
    const remainingTrades = openTrades.filter(t => t._id.toString() !== trade._id.toString());
    
    if (remainingTrades.length > 0) {
      const simulatedPortfolioLegs = remainingTrades.map(t => ({
        type: t.type,
        action: t.action,
        qty: t.qty,
        lotSize: t.lotSize,
        strike: t.strike,
        expiry: t.expiry,
        premium: t.entryPrice
      }));
      
      const newMarginEst = estimateMargin(simulatedPortfolioLegs, liveData.data.spot || trade.entryPrice, trade.symbol);
      const newTotalMargin = newMarginEst.totalMarginRequired;
      const simulatedCapital = user.virtualCapital + pnl;

      if (newTotalMargin > simulatedCapital) {
        await session.abortTransaction();
        return res.status(400).json({ 
          error: `Margin Call Protection: Exiting this hedge will expose your portfolio to a Naked margin requirement of ₹${newTotalMargin.toFixed(0)}, but your simulated capital is only ₹${simulatedCapital.toFixed(0)}. Please close your Short legs first.` 
        });
      }
    }
    // --- END MARGIN PROTECTION ---

    // Update User Capital using ACID Transaction
    await User.updateOne(
      { _id: req.user._id },
      { $inc: { realizedPnL: pnl, virtualCapital: pnl } },
      { session }
    );

    // Atomically close trade
    const updatedTrade = await Trade.findOneAndUpdate(
      { _id: tradeId, status: 'OPEN' },
      { status: 'CLOSED', exitPrice: verifiedExitPrice, exitTime: Date.now(), $inc: { realizedPnL: pnl } },
      { new: true, session }
    );

    if (!updatedTrade) {
      await session.abortTransaction();
      return res.status(400).json({ error: 'Trade already closed by another request' });
    }
    
    await session.commitTransaction();
    return res.json(updatedTrade);

  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    res.status(500).json({ error: error.message });
  } finally {
    session.endSession();
    releaseLock();
  }
};
