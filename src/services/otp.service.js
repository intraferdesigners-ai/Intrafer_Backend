const crypto = require('crypto');
const User = require('../models/User.model');

const OTP_EXPIRY_MINUTES = 10;
const MAX_ATTEMPTS = 3;

const generateOTP = () => crypto.randomInt(100000, 999999).toString();

const createAndSaveOTP = async (userId) => {
  const code = generateOTP();
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
  await User.findByIdAndUpdate(userId, { otp: { code, expiresAt, attempts: 0 } });
  return code;
};

const verifyOTP = async (userId, inputCode) => {
  const user = await User.findById(userId).select('otp');
  if (!user || !user.otp || !user.otp.code) {
    return { valid: false, message: 'OTP not found. Please request a new one.' };
  }

  const { code, expiresAt, attempts } = user.otp;

  if (attempts >= MAX_ATTEMPTS) {
    return { valid: false, message: 'Too many incorrect attempts. Please request a new OTP.' };
  }

  if (Date.now() > new Date(expiresAt).getTime()) {
    return { valid: false, message: 'OTP has expired. Please request a new one.' };
  }

  if (inputCode !== code) {
    await User.findByIdAndUpdate(userId, { $inc: { 'otp.attempts': 1 } });
    return { valid: false, message: 'Incorrect OTP.' };
  }

  await User.findByIdAndUpdate(userId, {
    $unset: { otp: '' },
    isPhoneVerified: true,
    isEmailVerified: true,
  });

  return { valid: true };
};

module.exports = { generateOTP, createAndSaveOTP, verifyOTP };
