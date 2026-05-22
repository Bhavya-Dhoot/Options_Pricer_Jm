import User from '../domain/User.js';
import jwt from 'jsonwebtoken';

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '30d' });
};

export const registerUser = async (req, res) => {
  const { username, password } = req.body;
  
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
};

export const loginUser = async (req, res) => {
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
};

export const getUserProfile = async (req, res) => {
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
};

export const updateCapital = async (req, res) => {
  const { virtualCapital } = req.body;
  if (virtualCapital === undefined || isNaN(virtualCapital)) {
    return res.status(400).json({ error: 'Invalid capital amount' });
  }
  
  const user = await User.findById(req.user._id);
  if (user) {
    user.virtualCapital = Number(virtualCapital);
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
};
