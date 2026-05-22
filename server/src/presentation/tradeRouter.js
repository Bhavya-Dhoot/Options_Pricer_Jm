import express from 'express';
import { placeTrade, getTrades, exitTrade, getLivePrices } from '../application/tradeManager.js';
import { protect } from './authMiddleware.js';

const router = express.Router();

router.route('/')
  .post(protect, placeTrade)
  .get(protect, getTrades);

router.get('/live-prices', protect, getLivePrices);

router.post('/exit', protect, exitTrade);

export default router;
