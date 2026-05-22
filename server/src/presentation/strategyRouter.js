import express from 'express';
import { saveStrategy, getSavedStrategies, deleteSavedStrategy } from '../application/strategyManager.js';
import { protect } from './authMiddleware.js';

const router = express.Router();

router.route('/')
  .post(protect, saveStrategy)
  .get(protect, getSavedStrategies);

router.delete('/:id', protect, deleteSavedStrategy);

export default router;
