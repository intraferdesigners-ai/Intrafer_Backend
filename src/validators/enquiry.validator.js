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
  // Optional now — absent when this OTP verification is completing the
  // vendor-agnostic "match me with designers" capture (no vendor picked
  // yet) rather than a specific vendor's enquiry. See submitGuestEnquiry.
  body('vendorId').optional({ checkFalsy: true }).isMongoId().withMessage('Valid vendorId is required'),
  body('projectType').optional().trim(),
  body('budget').optional().trim(),
  body('city').trim().notEmpty().withMessage('City is required'),
  body('requirements').optional().trim(),
  body('sessionId').optional().trim(),
];

// Background, no-form re-submission for a vendor a visitor hasn't engaged
// yet, using contact details verified by OTP earlier in this browser (see
// lib/session.js's saveContact / lib/enquiryFlow.js's autoSendVendorEnquiry
// on the frontend) — no OTP fields here since none is collected again.
const autoSubmitEnquiryRules = [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
  body('phone').matches(/^[6-9]\d{9}$/).withMessage('Valid 10-digit Indian mobile number required'),
  body('contactToken').notEmpty().withMessage('contactToken is required'),
  body('vendorId').isMongoId().withMessage('Valid vendorId is required'),
  body('city').optional().trim(),
];

module.exports = { sendEnquiryOtpRules, submitGuestEnquiryRules, autoSubmitEnquiryRules };
