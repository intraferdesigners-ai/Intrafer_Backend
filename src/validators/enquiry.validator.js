const { body } = require('express-validator');

// normalizeEmail() matches sendOtpRules/registerRules — without it, the
// guest-enquiry path could store an email verbatim while every other path
// normalizes it (e.g. stripping Gmail's +tag addressing), letting one real
// inbox bypass per-email OTP rate limits and dedup via +alias variants.
const sendEnquiryOtpRules = [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
  body('phone').matches(/^[6-9]\d{9}$/).withMessage('Valid 10-digit Indian mobile number required'),
];

const submitGuestEnquiryRules = [
  body('pendingId').notEmpty().withMessage('pendingId is required'),
  body('otp')
    .isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits')
    .isNumeric().withMessage('OTP must be 6 digits'),
  body('vendorId').isMongoId().withMessage('Valid vendorId is required'),
  body('projectType').optional().trim(),
  body('budget').optional().trim(),
  body('city').trim().notEmpty().withMessage('City is required'),
  body('requirements').optional().trim(),
];

module.exports = { sendEnquiryOtpRules, submitGuestEnquiryRules };
