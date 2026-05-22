import express from 'express';
import { registerUser, loginUser, getUserProfile, updateCapital } from '../application/auth.js';
import { protect } from './authMiddleware.js';

const router = express.Router();

router.post('/register', registerUser);
router.post('/login', loginUser);
router.get('/profile', protect, getUserProfile);
router.put('/capital', protect, updateCapital);

export default router;
