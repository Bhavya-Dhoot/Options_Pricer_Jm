import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    console.log('Connected to DB');
    try {
      await mongoose.connection.collection('users').dropIndex('email_1');
      console.log('Successfully dropped stale email_1 index');
    } catch (e) {
      console.error('Error dropping index (might not exist):', e.message);
    }
    process.exit(0);
  })
  .catch(e => {
    console.error(e);
    process.exit(1);
  });
