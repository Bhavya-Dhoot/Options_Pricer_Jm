import mongoose from 'mongoose';
import Trade from '../domain/Trade.js';
import User from '../domain/User.js';
import { getLatestPrice, registerSymbol, forceFetchLatestPrice, fetchEquitySpotPrice } from './priceCache.js';
import { getLotSize } from '../../scripMaster.js';
import { estimateMargin } from '../domain/marginCalculator.js';

// In-Memory Mutex Lock removed for distributed multi-node architecture
// We now rely purely on MongoDB ACID Transactions for true row-level concurrency locking

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
  const { symbol, type, strike, expiry, action, orderType, limitPrice, qty, expectedPrice, slippageTolerance, targetPrice, stopLoss } = req.body;
  
  if (!symbol || !/^[A-Z0-9&-]{1,20}$/.test(symbol)) {
    return res.status(400).json({ error: 'Invalid symbol format.' });
  }
  
  if (!qty || !Number.isInteger(qty) || qty <= 0 || qty > 5000) {
    return res.status(400).json({ error: 'Quantity must be a positive integer and cannot exceed 5000 lots per order.' });
  }
  
  if (orderType === 'limit') {
    const pLimit = Number(limitPrice);
    if (isNaN(pLimit) || pLimit <= 0) {
      return res.status(400).json({ error: 'Limit price must be a positive number.' });
    }
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const user = await User.findById(req.user._id).session(session);
    const verifiedLotSize = getLotSize(symbol);
    
    // Server-Side Price Verification
    registerSymbol(symbol); // Ensure symbol is tracked in background
    let verifiedEntryPrice = 0;
    let liveData = null; // Hoisted for reuse in margin calculation (OPT-2)
    
    if (orderType === 'market') {
      liveData = getLatestPrice(symbol);
      
      // Force an immediate API fetch if the cache is older than 500ms (slippage protection)
      if (!liveData || !liveData.timestamp || Date.now() - liveData.timestamp > 500) {
        try {
          liveData = await forceFetchLatestPrice(symbol);
        } catch (e) {
          console.warn(`[TradeManager] Force fetch failed for ${symbol}, using cache fallback.`, e.message);
        }
      }

      if (!liveData || !liveData.data) {
        await session.abortTransaction();
        return res.status(400).json({ error: 'Market data unavailable, try again in 1 second.' });
      }

      if (type === 'future') {
        const futPrice = liveData.data.futurePrices?.[expiry];
        if (!futPrice) {
          await session.abortTransaction();
          return res.status(400).json({ error: 'Invalid future expiry or pricing unavailable.' });
        }
        verifiedEntryPrice = futPrice;
      } else if (type === 'underlying') {
        verifiedEntryPrice = liveData.data.spot;
      } else {
        let chain = liveData.data.byExpiry?.[expiry];
        if (!chain) {
          try {
            const fresh = await forceFetchLatestPrice(symbol, expiry);
            chain = fresh.data.byExpiry?.[expiry];
          } catch (e) {}
        }
        if (!chain) { await session.abortTransaction(); return res.status(400).json({ error: `Market data for expiry ${expiry} is currently unavailable. Please try again.` }); }
        
        const strikeData = chain.find(s => (s.strikePrice || s.strike) === strike);
        if (!strikeData) { await session.abortTransaction(); return res.status(400).json({ error: 'Invalid strike price.' }); }
        
        const optData = type === 'call' ? strikeData.call : strikeData.put;
        if (!optData) { await session.abortTransaction(); return res.status(400).json({ error: 'Option data unavailable.' }); }
        
        // Slippage / Bid-Ask
        // If Buy, we pay the Ask. If Sell, we get the Bid.
        verifiedEntryPrice = action === 'buy' ? (optData.askPrice || optData.ltp) : (optData.bidPrice || optData.ltp);
      }
      
      // Slippage Tolerance Protection
      if (expectedPrice && slippageTolerance) {
        const deviation = Math.abs(verifiedEntryPrice - expectedPrice) / expectedPrice;
        if (deviation > (slippageTolerance / 100)) {
          await session.abortTransaction();
          return res.status(400).json({ error: `Price moved significantly. Expected ₹${expectedPrice}, Live is ₹${verifiedEntryPrice}. Order cancelled to prevent slippage.` });
        }
      }
    } else {
      verifiedEntryPrice = Number(limitPrice);
    }

    // Equity-specific overrides
    const isEquity = type === 'equity';
    const verifiedLotSizeFinal = isEquity ? 1 : verifiedLotSize;
    const finalStrike = isEquity ? 0 : strike;
    const finalExpiry = isEquity ? null : expiry;

    // If equity and market order, use lightweight spot-only fetch
    if (isEquity && orderType === 'market') {
      const spotLtp = await fetchEquitySpotPrice(symbol);
      if (!spotLtp) {
        await session.abortTransaction();
        return res.status(400).json({ error: 'Equity spot price unavailable. Try again.' });
      }
      verifiedEntryPrice = spotLtp;
    }

    // OPT-2 Fix: Reuse the already-fetched liveData for margin calculation
    // instead of calling getLatestPrice again (previously called 3 times).
    const spotForStandaloneMargin = liveData?.data?.spot || verifiedEntryPrice;
    let estimatedMargin;
    if (isEquity) {
      // Equity: 100% cash margin (no leverage)
      estimatedMargin = verifiedEntryPrice * qty * 1; // lotSize=1
    } else {
      const standaloneMarginEst = estimateMargin([{ type, action, qty, lotSize: verifiedLotSizeFinal, strike: finalStrike, expiry: finalExpiry, premium: verifiedEntryPrice }], spotForStandaloneMargin, symbol);
      estimatedMargin = standaloneMarginEst.totalMarginRequired;
    }

    if (estimatedMargin > Number.MAX_SAFE_INTEGER || (verifiedEntryPrice * qty * verifiedLotSize) > Number.MAX_SAFE_INTEGER) {
      await session.abortTransaction();
      return res.status(400).json({ error: 'Calculated order value exceeds system arithmetic limits.' });
    }

    // Dynamic Margin Check using holistic margin calculator for portfolio
    const openTrades = await Trade.find({ user: user._id, status: 'OPEN' }).session(session);
    
    // Portfolio Array Exhaustion (Bot Spam) Protection
    if (openTrades.length >= 50) {
      await session.abortTransaction();
      return res.status(400).json({ error: 'Maximum limit of 50 active portfolio legs reached. Close existing trades to open new ones.' });
    }
    
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
    const newLeg = { type, action, qty, lotSize: verifiedLotSizeFinal, strike: finalStrike, expiry: finalExpiry, premium: verifiedEntryPrice };
    const combinedLegs = [...allPortfolioLegs, newLeg];
    
    // OPT-2 Fix: Reuse liveData from price verification (no redundant 3rd call)
    const spotForMargin = liveData?.data?.spot || verifiedEntryPrice;
    
    const newMarginEst = estimateMargin(combinedLegs, spotForMargin, symbol);
    const newTotalMargin = newMarginEst.totalMarginRequired;

    let cashflow = 0;
    if (isEquity) {
      // Equity: full cash deduction for buy
      cashflow = action === 'buy' ? -(verifiedEntryPrice * qty) : (verifiedEntryPrice * qty);
    } else if (type !== 'future') {
       cashflow = (action === 'buy' ? -1 : 1) * verifiedEntryPrice * qty * verifiedLotSizeFinal;
    } else {
       cashflow = -estimatedMargin; // Deduct margin for futures entry
    }

    const postTradeCapital = user.virtualCapital + cashflow;

    if (newTotalMargin > postTradeCapital) {
      await session.abortTransaction();
      return res.status(400).json({ error: `Insufficient margin/capital. Required: ₹${newTotalMargin.toFixed(0)}, Available after premium: ₹${postTradeCapital.toFixed(0)}` });
    }

    await User.updateOne(
      { _id: req.user._id },
      { $inc: { virtualCapital: cashflow } },
      { session }
    );

    // Create the trade within the active session
    // Validate TP/SL if provided
    const finalEntryPrice = orderType === 'market' ? verifiedEntryPrice : Number(limitPrice);
    if (targetPrice != null) {
      if (typeof targetPrice !== 'number' || targetPrice <= 0) { await session.abortTransaction(); return res.status(400).json({ error: 'Target price must be a positive number.' }); }
      if (action === 'buy' && targetPrice <= finalEntryPrice) { await session.abortTransaction(); return res.status(400).json({ error: 'For Buy positions, target price must be above entry price.' }); }
      if (action === 'sell' && targetPrice >= finalEntryPrice) { await session.abortTransaction(); return res.status(400).json({ error: 'For Sell positions, target price must be below entry price.' }); }
    }
    if (stopLoss != null) {
      if (typeof stopLoss !== 'number' || stopLoss <= 0) { await session.abortTransaction(); return res.status(400).json({ error: 'Stop loss must be a positive number.' }); }
      if (action === 'buy' && stopLoss >= finalEntryPrice) { await session.abortTransaction(); return res.status(400).json({ error: 'For Buy positions, stop loss must be below entry price.' }); }
      if (action === 'sell' && stopLoss <= finalEntryPrice) { await session.abortTransaction(); return res.status(400).json({ error: 'For Sell positions, stop loss must be above entry price.' }); }
    }

    const trade = await Trade.create([{
      user: req.user._id,
      symbol,
      type,
      strike: finalStrike,
      expiry: finalExpiry,
      action,
      orderType,
      limitPrice,
      qty,
      lotSize: verifiedLotSizeFinal,
      marginBlocked: estimatedMargin,
      entryPrice: orderType === 'market' ? verifiedEntryPrice : null,
      entryTime: orderType === 'market' ? Date.now() : null,
      status: orderType === 'market' ? 'OPEN' : 'PENDING',
      targetPrice: targetPrice || null,
      stopLoss: stopLoss || null
    }], { session, ordered: true });

    await session.commitTransaction();
    res.status(201).json(trade[0]);
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    res.status(400).json({ error: error.message });
  } finally {
    session.endSession();
  }
};

export const placeBatchTrades = async (req, res) => {
  const { legs, symbol, slippageTolerance } = req.body;
  if (!legs || !Array.isArray(legs) || legs.length === 0) {
    return res.status(400).json({ error: 'Valid legs array required.' });
  }
  if (legs.length > 20) {
    return res.status(400).json({ error: 'Maximum of 20 legs allowed per batch trade.' });
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const user = await User.findById(req.user._id).session(session);
    const verifiedLegs = [];
    const baseSymbol = symbol || legs[0].symbol || 'NIFTY'; 
    if (!baseSymbol || !/^[A-Z0-9&-]{1,20}$/.test(baseSymbol)) {
      await session.abortTransaction();
      return res.status(400).json({ error: 'Invalid symbol format.' });
    }
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
      await session.abortTransaction();
      return res.status(400).json({ error: 'Market data unavailable, try again in 1 second.' });
    }
    const spot = liveData.data.spot;

    for (const leg of legs) {
      if (!leg.qty || !Number.isInteger(leg.qty) || leg.qty <= 0 || leg.qty > 5000) {
        await session.abortTransaction();
        return res.status(400).json({ error: 'Quantity must be a positive integer and cannot exceed 5000 lots per order.' });
      }

      if (leg.symbol && leg.symbol.toUpperCase() !== baseSymbol.toUpperCase()) {
        await session.abortTransaction();
        return res.status(400).json({ error: `Batch trades cannot mix symbols. Expected ${baseSymbol} but got ${leg.symbol}.` });
      }
      
      if (leg.orderType === 'limit') {
        const pLimit = Number(leg.limitPrice);
        if (isNaN(pLimit) || pLimit <= 0) {
          await session.abortTransaction();
          return res.status(400).json({ error: 'Limit price must be a positive number.' });
        }
      }
      
      const verifiedLotSize = getLotSize(leg.symbol || baseSymbol);
      let verifiedEntryPrice = 0;
      
      if (leg.type === 'future') {
        const futPrice = liveData.data.futurePrices?.[leg.expiry];
        if (!futPrice) { await session.abortTransaction(); return res.status(400).json({ error: 'Future pricing unavailable.' }); }
        verifiedEntryPrice = futPrice;
      } else if (leg.type === 'underlying') {
        verifiedEntryPrice = liveData.data.spot;
      } else {
        let chain = liveData.data.byExpiry?.[leg.expiry];
        if (!chain) {
          try {
            const fresh = await forceFetchLatestPrice(baseSymbol, leg.expiry);
            chain = fresh.data.byExpiry?.[leg.expiry];
          } catch (e) {}
        }
        if (!chain) { await session.abortTransaction(); return res.status(400).json({ error: `Market data for expiry ${leg.expiry} is currently unavailable. Please try again.` }); }
        const strikeData = chain.find(s => (s.strikePrice || s.strike) === leg.strike);
        if (!strikeData) { await session.abortTransaction(); return res.status(400).json({ error: 'Invalid strike.' }); }
        const optData = leg.type === 'call' ? strikeData.call : strikeData.put;
        if (!optData) { await session.abortTransaction(); return res.status(400).json({ error: 'Option data unavailable.' }); }
        verifiedEntryPrice = leg.action === 'buy' ? (optData.askPrice || optData.ltp) : (optData.bidPrice || optData.ltp);
      }
      
      // Slippage Tolerance Protection for Batch Trades
      if (leg.expectedPrice && slippageTolerance) {
        const deviation = Math.abs(verifiedEntryPrice - leg.expectedPrice) / leg.expectedPrice;
        if (deviation > (slippageTolerance / 100)) {
          await session.abortTransaction();
          return res.status(400).json({ error: `Price moved significantly on strike ${leg.strike}. Expected ₹${leg.expectedPrice}, Live is ₹${verifiedEntryPrice}. Batch order cancelled.` });
        }
      }
      
      // Safety Limit
      if ((verifiedEntryPrice * leg.qty * verifiedLotSize) > Number.MAX_SAFE_INTEGER) {
         await session.abortTransaction();
         return res.status(400).json({ error: 'Calculated order value exceeds system arithmetic limits.' });
      }
      
      const standaloneMarginEst = estimateMargin([{ type: leg.type, action: leg.action, qty: leg.qty, lotSize: verifiedLotSize, strike: leg.strike, expiry: leg.expiry, premium: verifiedEntryPrice }], spot, leg.symbol || baseSymbol);
      
      verifiedLegs.push({
        ...leg,
        lotSize: verifiedLotSize,
        premium: verifiedEntryPrice,
        entryPrice: verifiedEntryPrice,
        marginBlocked: standaloneMarginEst.totalMarginRequired
      });
    }

    // Dynamic Margin Check using holistic margin calculator for portfolio
    const openTrades = await Trade.find({ user: user._id, status: 'OPEN' }).session(session);
    
    // Portfolio Array Exhaustion (Bot Spam) Protection
    if (openTrades.length + verifiedLegs.length > 50) {
      await session.abortTransaction();
      return res.status(400).json({ error: 'Maximum limit of 50 active portfolio legs reached. Batch order would exceed limit.' });
    }
    
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
    
    if (newTotalMargin > Number.MAX_SAFE_INTEGER) {
      await session.abortTransaction();
      return res.status(400).json({ error: 'Calculated margin exceeds system arithmetic limits.' });
    }

    let totalCashflow = 0;
    verifiedLegs.forEach(leg => {
      if (leg.type !== 'future') {
         totalCashflow += (leg.action === 'buy' ? -1 : 1) * leg.entryPrice * leg.qty * leg.lotSize;
      } else {
         totalCashflow -= leg.marginBlocked;
      }
    });

    const postTradeCapital = user.virtualCapital + totalCashflow;

    if (newTotalMargin > postTradeCapital) {
      await session.abortTransaction();
      return res.status(400).json({ error: `Insufficient margin/capital. Required: ₹${newTotalMargin.toFixed(0)}, Available after premium: ₹${postTradeCapital.toFixed(0)}` });
    }

    await User.updateOne(
      { _id: req.user._id },
      { $inc: { virtualCapital: totalCashflow } },
      { session }
    );
    
    // Create all trades atomically
    const tradeDocs = verifiedLegs.map(leg => ({
        user: req.user._id,
        symbol: leg.symbol || symbol,
        type: leg.type,
        strike: leg.strike,
        expiry: leg.expiry,
        action: leg.action,
        orderType: 'market',
        qty: leg.qty,
        lotSize: leg.lotSize,
        marginBlocked: leg.marginBlocked, 
        entryPrice: leg.entryPrice,
        entryTime: Date.now(),
        status: 'OPEN',
        targetPrice: leg.targetPrice || null,
        stopLoss: leg.stopLoss || null
    }));
    
    const newTrades = await Trade.create(tradeDocs, { session, ordered: true });

    await session.commitTransaction();
    res.status(201).json(newTrades);
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    res.status(400).json({ error: error.message });
  } finally {
    session.endSession();
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
    const tier = req.query.tier || (isPriority ? 'priority' : 'regular');
    const prices = {};
    for (const sym of symbols) {
      registerSymbol(sym, tier); // Track symbol at the appropriate priority tier
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
  
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const trade = await Trade.findById(tradeId).session(session);
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

    if (trade.type === 'equity') {
      verifiedExitPrice = liveData.data.spot;
      if (!verifiedExitPrice) {
        await session.abortTransaction();
        return res.status(400).json({ error: 'Equity spot price unavailable.' });
      }
    } else if (trade.type === 'future') {
      const futPrice = liveData.data.futurePrices?.[trade.expiry];
      if (!futPrice) { 
        const expiryTime = parseExpiry(trade.expiry);
        if (expiryTime && Date.now() > expiryTime + 86400000) {
          await session.abortTransaction();
          return res.status(400).json({ error: 'This futures contract has expired and will be automatically cash-settled by the nightly clearing engine. It cannot be exited manually.' });
        }
        await session.abortTransaction(); return res.status(400).json({ error: 'Market data unavailable for this future expiry.' }); 
      }
      verifiedExitPrice = futPrice;
    } else if (trade.type === 'underlying') {
      verifiedExitPrice = liveData.data.spot;
    } else {
      const chain = liveData.data.byExpiry?.[trade.expiry];
      if (!chain) {
        const expiryTime = parseExpiry(trade.expiry);
        if (expiryTime && Date.now() > expiryTime + 86400000) {
          await session.abortTransaction();
          return res.status(400).json({ error: 'This options contract has expired and will be automatically cash-settled by the nightly clearing engine. It cannot be exited manually.' });
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
    // OPT-6 Fix: Use scripMaster.getLotSize() consistently instead of inline hardcoding
    let lotSize = trade.lotSize;
    if (!lotSize) {
      lotSize = getLotSize(trade.symbol);
    }
    const pnl = direction * (verifiedExitPrice - trade.entryPrice) * parsedExitQty * lotSize;
    
    // Safety check to prevent NaN propagation to MongoDB
    if (isNaN(pnl)) { await session.abortTransaction(); return res.status(400).json({ error: 'Critical calculation error: Resulting PnL is NaN' }); }

    let exitCashflow = 0;
    if (trade.type === 'equity') {
      exitCashflow = verifiedExitPrice * parsedExitQty; // Full cash return for equity sell
    } else if (trade.type !== 'future') {
      exitCashflow = (trade.action === 'buy' ? 1 : -1) * verifiedExitPrice * parsedExitQty * lotSize;
    } else {
      exitCashflow = pnl + (trade.marginBlocked || 0);
    }

    // --- MARGIN EXPLOIT PROTECTION (Simulated Exit Portfolio Validation) ---
    const user = await User.findById(req.user._id).session(session);
    if (!user) { await session.abortTransaction(); return res.status(404).json({ error: 'User not found' }); }

    const openTrades = await Trade.find({ user: user._id, status: 'OPEN', symbol: trade.symbol }).session(session);
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
      const simulatedCapital = user.virtualCapital + exitCashflow;

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
      { $inc: { realizedPnL: pnl, virtualCapital: exitCashflow } },
      { session }
    );

    // Atomically close trade
    const updatedTrade = await Trade.findOneAndUpdate(
      { _id: tradeId, status: 'OPEN' },
      { status: 'CLOSED', exitPrice: verifiedExitPrice, exitTime: Date.now(), exitReason: 'MANUAL', $inc: { realizedPnL: pnl } },
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
  }
};
