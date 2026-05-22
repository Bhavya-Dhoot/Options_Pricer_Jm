import User from '../domain/User.js';
import bcrypt from 'bcryptjs';

export const seedSuperUser = async () => {
  try {
    const adminExists = await User.findOne({ username: 'Amish' });
    if (!adminExists) {
      console.log('[Seed] Creating Super User (Amish)...');
      await User.create({
        username: 'Amish',
        password: 'Amish', // Pre-save hook hashes it automatically
        role: 'admin',
        virtualCapital: 100000000
      });
      console.log('[Seed] Super User Amish created successfully!');
    } else {
      // Ensure Amish has admin role just in case
      if (adminExists.role !== 'admin') {
        adminExists.role = 'admin';
        await adminExists.save();
        console.log('[Seed] Upgraded Amish to admin.');
      }
    }
  } catch (err) {
    console.error('[Seed] Error seeding super user:', err.message);
  }
};
