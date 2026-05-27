import express from 'express';
import { fetchMarketDataChain } from '../application/marketDataService.js';
import { estimateMargin } from '../../../src/utils/marginCalculator.js';
import { placeBatchTrades } from '../application/tradeManager.js';
import User from '../domain/User.js';

const router = express.Router();

// Simple Agent Auth Middleware
const agentProtect = async (req, res, next) => {
  const agentKey = req.headers['x-agent-key'];
  if (!agentKey || agentKey !== (process.env.AGENT_API_KEY || 'agent_super_secret_123')) {
    return res.status(401).json({ error: 'Unauthorized Agent Access' });
  }

  try {
    // Find or create a default Agent User to attach trades to
    let agentUser = await User.findOne({ email: 'agent@system.local' });
    if (!agentUser) {
      agentUser = await User.create({
        name: 'AI Agent',
        email: 'agent@system.local',
        password: 'AIAgentPassword123!',
        virtualCapital: 1000000000, // 1 Billion for Agent testing
        isSuperUser: true
      });
    }
    req.user = agentUser;
    next();
  } catch (error) {
    res.status(500).json({ error: 'Agent Authentication Failed' });
  }
};

/**
 * GET /api/agent/chain
 * Returns a highly compressed option chain for LLMs (Strikes, Call Premium, Put Premium, Call IV, Put IV)
 */
router.get('/chain', agentProtect, async (req, res) => {
  try {
    const symbol = req.query.symbol?.toUpperCase() || 'NIFTY';
    // SEC-3 Fix: Validate symbol format matching trade endpoint pattern
    if (!/^[A-Z0-9&-]{1,20}$/.test(symbol)) {
      return res.status(400).json({ error: 'Invalid symbol format.' });
    }
    const chainData = await fetchMarketDataChain(symbol, req.query.expiry, req.query.futExpiry);
    
    // Compress payload for Agent LLM token limit
    const targetExpiry = Object.keys(chainData.byExpiry)[0];
    const rawStrikes = chainData.byExpiry[targetExpiry] || [];
    
    const compressedStrikes = rawStrikes.map(s => ({
      strike: s.strikePrice,
      ce: s.call ? { p: s.call.ltp, iv: Math.round(s.call.iv) } : null,
      pe: s.put ? { p: s.put.ltp, iv: Math.round(s.put.iv) } : null
    }));

    res.json({
      symbol,
      spot: chainData.spot,
      timestamp: chainData.timestamp,
      expiry: targetExpiry,
      chain: compressedStrikes
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/agent/simulate
 * Simulates a strategy to calculate margin and PnL boundaries.
 */
router.post('/simulate', agentProtect, async (req, res) => {
  try {
    const { legs, symbol = 'NIFTY', spot = 24500 } = req.body;
    if (!legs || !Array.isArray(legs)) {
      return res.status(400).json({ error: 'Array of legs is required' });
    }

    const margin = estimateMargin(legs, spot, symbol);
    
    // Very basic Max Profit/Loss heuristic for Agent
    let maxProfit = 0;
    let maxLoss = 0;
    
    legs.forEach(leg => {
      const isBuy = leg.action === 'buy';
      if (leg.type === 'call' || leg.type === 'put') {
        if (isBuy) {
          maxLoss -= (leg.premium * leg.qty * (leg.lotSize || 25));
          maxProfit = Infinity;
        } else {
          maxProfit += (leg.premium * leg.qty * (leg.lotSize || 25));
          maxLoss = -Infinity;
        }
      }
    });

    res.json({ margin, maxProfit, maxLoss });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/agent/execute
 * Headless execution of a batch trade
 */
router.post('/execute', agentProtect, placeBatchTrades);

export default router;
