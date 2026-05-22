import User from '../domain/User.js';
import jwt from 'jsonwebtoken';

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '30d' });
};

export const registerUser = async (req, res) => {
  const { email, password, virtualCapital } = req.body;
  
  const userExists = await User.findOne({ email });
  if (userExists) {
    return res.status(400).json({ error: 'User already exists' });
  }
  
  const user = await User.create({
    email,
    password,
    virtualCapital: virtualCapital || 1000000
  });
  
  if (user) {
    res.status(201).json({
      _id: user._id,
      email: user.email,
      virtualCapital: user.virtualCapital,
      token: generateToken(user._id)
    });
  } else {
    res.status(400).json({ error: 'Invalid user data' });
  }
};

export const loginUser = async (req, res) => {
  const { email, password } = req.body;
  
  const user = await User.findOne({ email });
  if (user && (await user.matchPassword(password))) {
    res.json({
      _id: user._id,
      email: user.email,
      virtualCapital: user.virtualCapital,
      token: generateToken(user._id)
    });
  } else {
    res.status(401).json({ error: 'Invalid email or password' });
  }
};

export const getUserProfile = async (req, res) => {
  const user = await User.findById(req.user._id);
  if (user) {
    res.json({
      _id: user._id,
      email: user.email,
      virtualCapital: user.virtualCapital,
      realizedPnL: user.realizedPnL
    });
  } else {
    res.status(404).json({ error: 'User not found' });
  }
};
