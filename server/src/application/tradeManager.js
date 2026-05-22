import Trade from '../domain/Trade.js';
import User from '../domain/User.js';
// In a real system, you would validate prices against Live API before executing.
// For MVP, we trust the frontend's fetched price for MARKET orders.

export const placeTrade = async (req, res) => {
  const { symbol, type, strike, expiry, action, orderType, limitPrice, qty, lotSize, entryPrice } = req.body;
  
  try {
    const user = await User.findById(req.user._id);
    
    // Simulate margin check (approximate 15% for naked short, premium for long)
    let estimatedMargin = 0;
    const contractValue = entryPrice * qty * lotSize;
    
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
      entryPrice: orderType === 'market' ? entryPrice : null,
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
    res.json(trades);
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
