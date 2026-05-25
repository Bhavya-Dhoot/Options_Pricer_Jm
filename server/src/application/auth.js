import User from '../domain/User.js';
import Trade from '../domain/Trade.js';
import jwt from 'jsonwebtoken';

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '30d' });
};

export const registerUser = async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long' });
    }
    
    const userExists = await User.findOne({ username });
    if (userExists) {
      return res.status(400).json({ error: 'User already exists' });
    }
    
    const user = await User.create({
      username,
      password,
    });
    
    if (user) {
      res.status(201).json({
        _id: user._id,
        username: user.username,
        role: user.role,
        virtualCapital: user.virtualCapital,
        realizedPnL: user.realizedPnL,
        token: generateToken(user._id)
      });
    } else {
      res.status(400).json({ error: 'Invalid user data' });
    }
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

export const loginUser = async (req, res) => {
  try {
    const { username, password } = req.body;
    
    const user = await User.findOne({ username });
    if (user && (await user.matchPassword(password))) {
      res.json({
        _id: user._id,
        username: user.username,
        role: user.role,
        virtualCapital: user.virtualCapital,
        realizedPnL: user.realizedPnL,
        token: generateToken(user._id)
      });
    } else {
      res.status(401).json({ error: 'Invalid username or password' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const getUserProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (user) {
      res.json({
        _id: user._id,
        username: user.username,
        role: user.role,
        virtualCapital: user.virtualCapital,
        realizedPnL: user.realizedPnL
      });
    } else {
      res.status(404).json({ error: 'User not found' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const updateCapital = async (req, res) => {
  try {
    const { virtualCapital } = req.body;
    if (virtualCapital === undefined || isNaN(virtualCapital) || virtualCapital < 1000 || virtualCapital > 1000000000) {
      return res.status(400).json({ error: 'Invalid capital amount. Must be between 1K and 100Cr.' });
    }
    
    // Ghost Capital Vulnerability Fix
    const openTrades = await Trade.find({ user: req.user._id, status: 'OPEN' }).limit(1);
    if (openTrades.length > 0) {
      return res.status(400).json({ error: 'Cannot reset capital while holding open positions.' });
    }

    const user = await User.findById(req.user._id);
    if (user) {
      user.virtualCapital = Number(virtualCapital);
      user.realizedPnL = 0;
      await user.save();
      
      res.json({
        _id: user._id,
        username: user.username,
        role: user.role,
        virtualCapital: user.virtualCapital,
        realizedPnL: user.realizedPnL
      });
    } else {
      res.status(404).json({ error: 'User not found' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const addCapital = async (req, res) => {
  try {
    const { amount } = req.body;
    if (amount === undefined || isNaN(amount) || amount <= 0 || amount > 1000000000) {
      return res.status(400).json({ error: 'Invalid capital amount. Must be between 1 and 100Cr.' });
    }
    
    const user = await User.findById(req.user._id);
    if (user) {
      user.virtualCapital = user.virtualCapital + Number(amount);
      await user.save();
      
      res.json({
        _id: user._id,
        username: user.username,
        role: user.role,
        virtualCapital: user.virtualCapital,
        realizedPnL: user.realizedPnL
      });
    } else {
      res.status(404).json({ error: 'User not found' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
