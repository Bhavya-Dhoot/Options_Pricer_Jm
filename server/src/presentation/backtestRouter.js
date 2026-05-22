import express from 'express';
import { MarketSnapshot } from '../domain/MarketSnapshot.js';

const router = express.Router();

// Get list of available timestamps for a symbol in the last 24 hours
router.get('/timestamps', async (req, res) => {
  try {
    const symbol = (req.query.symbol || 'NIFTY').toUpperCase();
    
    // Find timestamps for this symbol, sorted descending
    const snapshots = await MarketSnapshot.find({ symbol })
      .select('timestamp')
      .sort({ timestamp: -1 })
      .limit(1440); // Max 24 hours at 1 snapshot/min
      
    res.json(snapshots.map(s => s.timestamp));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get snapshot data for a specific timestamp
router.get('/snapshot', async (req, res) => {
  try {
    const symbol = (req.query.symbol || 'NIFTY').toUpperCase();
    const timestamp = req.query.timestamp;
    
    if (!timestamp) {
      return res.status(400).json({ error: 'timestamp is required' });
    }

    const snapshot = await MarketSnapshot.findOne({ 
      symbol, 
      timestamp: new Date(timestamp) 
    });
    
    if (!snapshot) {
      return res.status(404).json({ error: 'Snapshot not found' });
    }
    
    res.json(snapshot.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
