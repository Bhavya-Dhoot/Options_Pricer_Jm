import mongoose from 'mongoose';

const marketSnapshotSchema = new mongoose.Schema({
  symbol: { type: String, required: true, index: true },
  timestamp: { type: Date, required: true },
  data: { type: mongoose.Schema.Types.Mixed, required: true }
});

// TTL Index: Documents automatically delete 24 hours (86400 seconds) after 'timestamp'
marketSnapshotSchema.index({ timestamp: 1 }, { expireAfterSeconds: 86400 });

export const MarketSnapshot = mongoose.model('MarketSnapshot', marketSnapshotSchema);
