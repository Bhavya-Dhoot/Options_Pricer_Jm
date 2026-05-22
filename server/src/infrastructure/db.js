import mongoose from 'mongoose';

export const connectDB = async (retries = 5) => {
  while (retries > 0) {
    try {
      const conn = await mongoose.connect(process.env.MONGO_URI, {
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
      });
      console.log(`[MongoDB] Connected to ${conn.connection.host}`);
      return;
    } catch (error) {
      console.error(`[MongoDB] Connection Error: ${error.message}`);
      retries -= 1;
      if (retries === 0) {
        console.error('[MongoDB] Max retries reached. Exiting.');
        process.exit(1);
      }
      console.log(`[MongoDB] Retrying connection... (${retries} retries left)`);
      await new Promise(res => setTimeout(res, 3000));
    }
  }
};
