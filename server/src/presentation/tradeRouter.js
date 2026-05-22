import express from 'express';
import { placeTrade, placeBatchTrades, getTrades, exitTrade, getLivePrices } from '../application/tradeManager.js';
import { protect } from './authMiddleware.js';

const router = express.Router();

router.route('/')
  .post(protect, placeTrade)
  .get(protect, getTrades);

router.get('/live-prices', protect, getLivePrices);

router.post('/batch', protect, placeBatchTrades);

router.post('/exit', protect, exitTrade);

export default router;
