import mongoose from 'mongoose';

const legSchema = new mongoose.Schema({
  type: { type: String, required: true },
  strike: { type: Number, required: true },
  action: { type: String, required: true },
  qty: { type: Number, required: true },
  expiry: { type: String }, // Optional, can be relative like "next" or specific date
  lotSize: { type: Number }
});

const savedStrategySchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true },
  description: { type: String },
  legs: [legSchema],
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.model('SavedStrategy', savedStrategySchema);
