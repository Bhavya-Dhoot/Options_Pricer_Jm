import Trade from '../domain/Trade.js';
import User from '../domain/User.js';
import { getLatestPrice, registerSymbol } from './priceCache.js';

export const placeTrade = async (req, res) => {
  const { symbol, type, strike, expiry, action, orderType, limitPrice, qty, lotSize } = req.body;
  
  try {
    const user = await User.findById(req.user._id);
    
    // Server-Side Price Verification
    registerSymbol(symbol); // Ensure symbol is tracked in background
    let verifiedEntryPrice = 0;
    
    if (orderType === 'market') {
      const liveData = getLatestPrice(symbol);
      if (!liveData || !liveData.data) {
        return res.status(400).json({ error: 'Market data unavailable, try again in 1 second.' });
      }

      if (type === 'future') {
        verifiedEntryPrice = liveData.data.futurePrices?.[expiry] || liveData.data.spot;
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

    // Simulate margin check
    let estimatedMargin = 0;
    const contractValue = verifiedEntryPrice * qty * lotSize;
    
    if (action === 'buy') {
      estimatedMargin = contractValue; // Need 100% premium
    } else {
      estimatedMargin = contractValue * 0.15 * 50; // VERY rough estimate for naked shorts
    }

    // In a fully developed margin system, we would calculate exactly using marginCalculator logic on backend.
    
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
      lotSize,
      entryPrice: orderType === 'market' ? verifiedEntryPrice : null,
      entryTime: orderType === 'market' ? Date.now() : null,
      status: orderType === 'market' ? 'OPEN' : 'PENDING'
    });

    res.status(201).json(trade);
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
    
    if (exitQty > trade.qty) return res.status(400).json({ error: 'Exit qty exceeds open qty' });

    // Calculate PnL for this exit
    const direction = trade.action === 'buy' ? 1 : -1;
    const pnl = direction * (exitPrice - trade.entryPrice) * exitQty * trade.lotSize;
    
    // Update User Capital
    const user = await User.findById(req.user._id);
    user.realizedPnL += pnl;
    user.virtualCapital += pnl;
    await user.save();

    if (exitQty === trade.qty) {
      // Full exit
      trade.status = 'CLOSED';
      trade.exitPrice = exitPrice;
      trade.exitTime = Date.now();
      trade.realizedPnL += pnl;
      await trade.save();
      return res.json(trade);
    } else {
      // Partial Exit - reduce qty of original trade, create a closed child trade to log history?
      // For simplicity, we just reduce qty and add to realizedPnL
      trade.qty -= exitQty;
      trade.realizedPnL += pnl;
      await trade.save();
      return res.json(trade);
    }

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
