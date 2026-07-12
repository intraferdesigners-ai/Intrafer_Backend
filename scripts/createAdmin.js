require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../src/models/User.model');

const createAdmin = async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  const existing = await User.findOne({ email: 'admin@intrafer.com' });
  if (existing) {
    console.log('Admin already exists:', existing._id.toString());
    await mongoose.disconnect();
    process.exit(0);
  }

  const admin = await User.create({
    name: 'Intrafer Admin',
    email: 'admin@intrafer.com',
    phone: '9000000000',
    passwordHash: 'Admin@1234',
    role: 'admin',
    isEmailVerified: true,
    isPhoneVerified: true,
  });

  console.log('Admin created:', admin._id.toString());
  await mongoose.disconnect();
  process.exit(0);
};

createAdmin().catch((err) => {
  console.error(err);
  process.exit(1);
});
