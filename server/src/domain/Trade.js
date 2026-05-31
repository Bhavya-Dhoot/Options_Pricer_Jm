import mongoose from 'mongoose';

const tradeSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  symbol: { type: String, required: true },
  type: { type: String, enum: ['call', 'put', 'future', 'underlying', 'equity'], required: true },
  strike: { type: Number, default: 0 }, // Not required: futures have no strike price
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
  
  // Optional TP/SL
  targetPrice: { type: Number, default: null },
  stopLoss: { type: Number, default: null },
  exitReason: { type: String, enum: ['MANUAL', 'TARGET_HIT', 'STOPLOSS_HIT', null], default: null },
  
  createdAt: { type: Date, default: Date.now }
});

// DB Optimization: Compound index for blazing fast O(1) queries on open trades
tradeSchema.index({ user: 1, status: 1 });
tradeSchema.index({ user: 1, status: 1, symbol: 1 });
// OPT-5: Compound index for TP/SL engine queries (status + targetPrice/stopLoss)
tradeSchema.index({ status: 1, targetPrice: 1, stopLoss: 1 });
// Equity segment: fast queries for equity-only trades
tradeSchema.index({ user: 1, status: 1, type: 1 });

export default mongoose.model('Trade', tradeSchema);
