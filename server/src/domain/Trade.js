import mongoose from 'mongoose';

const tradeSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  symbol: { type: String, required: true },
  type: { type: String, enum: ['call', 'put', 'future', 'underlying'], required: true },
  strike: { type: Number, required: true },
  expiry: { type: String }, // e.g., '27-JUN-2026'
  action: { type: String, enum: ['buy', 'sell'], required: true },
  orderType: { type: String, enum: ['market', 'limit'], required: true },
  limitPrice: { type: Number },
  status: { type: String, enum: ['PENDING', 'OPEN', 'CLOSED'], default: 'OPEN' },
  
  entryPrice: { type: Number },
  entryTime: { type: Date },
  
  qty: { type: Number, required: true },
  lotSize: { type: Number, required: true },
  marginBlocked: { type: Number, default: 0 },
  
  exitPrice: { type: Number },
  exitTime: { type: Date },
  
  realizedPnL: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.model('Trade', tradeSchema);
