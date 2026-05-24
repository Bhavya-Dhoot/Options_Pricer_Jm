import Trade from '../domain/Trade.js';
import User from '../domain/User.js';
import { getLatestPrice, registerSymbol, forceFetchLatestPrice } from './priceCache.js';
import { getLotSize } from '../../scripMaster.js';
import { estimateMargin } from '../domain/marginCalculator.js';

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
  
  try {
    const trade = await Trade.findById(tradeId);
    if (!trade) return res.status(404).json({ error: 'Trade not found' });
    if (trade.user.toString() !== req.user._id.toString()) return res.status(401).json({ error: 'Unauthorized' });
    if (trade.status !== 'OPEN') return res.status(400).json({ error: 'Trade is not open' });
    
    const parsedExitQty = Number(exitQty);
    if (isNaN(parsedExitQty) || parsedExitQty <= 0) return res.status(400).json({ error: 'Invalid exit quantity' });
    if (parsedExitQty > trade.qty) return res.status(400).json({ error: 'Exit qty exceeds open qty' });
    if (parsedExitQty !== trade.qty) return res.status(400).json({ error: 'Partial exits are not supported in this version. Must exit full quantity.' });

    // Server-Side Verification of Exit Price
    let verifiedExitPrice = 0;
    const liveData = getLatestPrice(trade.symbol);
    
    if (!liveData || !liveData.data) {
      return res.status(400).json({ error: 'Market data temporarily unavailable. Please try exiting again.' });
    }

    if (trade.type === 'future') {
      const futPrice = liveData.data.futurePrices?.[trade.expiry];
      if (!futPrice) return res.status(400).json({ error: 'Market data unavailable for this future expiry.' });
      verifiedExitPrice = futPrice;
    } else if (trade.type === 'underlying') {
      verifiedExitPrice = liveData.data.spot;
    } else {
      const chain = liveData.data.byExpiry?.[trade.expiry];
      if (!chain) {
        const expiryTime = parseExpiry(trade.expiry);
        if (expiryTime && Date.now() > expiryTime + 86400000) {
          // The option chain is missing because it expired.
          // Force-settle at exact intrinsic value using the current spot price.
          const spot = liveData.data.spot;
          verifiedExitPrice = trade.type === 'call' ? Math.max(spot - trade.strike, 0) : Math.max(trade.strike - spot, 0);
        } else {
          return res.status(400).json({ error: 'Market data unavailable for this option expiry.' });
        }
      } else {
        const strikeData = chain.find(s => (s.strikePrice || s.strike) === trade.strike);
      if (!strikeData) return res.status(400).json({ error: 'Market data unavailable for this strike.' });
      
      const optData = trade.type === 'call' ? strikeData.call : strikeData.put;
      if (!optData) return res.status(400).json({ error: 'Market data unavailable for this option.' });
      
      // MTM Exit: If we bought, we exit by selling to the Bid. If we sold, we exit by buying the Ask.
      verifiedExitPrice = trade.action === 'buy' ? (optData.bidPrice || optData.ltp) : (optData.askPrice || optData.ltp);
      }
    }

    // Calculate PnL for this exit
    const direction = trade.action === 'buy' ? 1 : -1;
    const pnl = direction * (verifiedExitPrice - trade.entryPrice) * parsedExitQty * trade.lotSize;
    
    // Update User Capital
    // Update User Capital using atomic $inc to prevent concurrency race conditions
    await User.updateOne(
      { _id: req.user._id },
      { $inc: { realizedPnL: pnl, virtualCapital: pnl } }
    );

    // Atomically close trade
    const updatedTrade = await Trade.findOneAndUpdate(
      { _id: tradeId, status: 'OPEN' },
      { status: 'CLOSED', exitPrice: verifiedExitPrice, exitTime: Date.now(), $inc: { realizedPnL: pnl } },
      { new: true }
    );

    if (!updatedTrade) {
      // Revert user capital if trade closure failed concurrently
      await User.updateOne(
        { _id: req.user._id },
        { $inc: { realizedPnL: -pnl, virtualCapital: -pnl } }
      );
      return res.status(400).json({ error: 'Trade already closed by another request' });
    }
    
    return res.json(updatedTrade);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
