const express = require('express');
const { sendEnquiryOTP, submitGuestEnquiry, autoSubmitEnquiry } = require('../controllers/enquiry.controller');
const validate = require('../middleware/validate');
const { otpLimiter } = require('../middleware/rateLimiter');
const { sendEnquiryOtpRules, submitGuestEnquiryRules, autoSubmitEnquiryRules } = require('../validators/enquiry.validator');

const router = express.Router();

// Guest-only OTP + lead submission for the public "Submit enquiry" flow —
// never touches the User collection, never issues a session. See
// enquiry.controller.js. Same otpLimiter budget (5 per 10 min) as the
// homeowner/vendor OTP endpoints in auth.routes.js.
router.post('/send-otp', otpLimiter, ...sendEnquiryOtpRules, validate, sendEnquiryOTP);
router.post('/submit', otpLimiter, ...submitGuestEnquiryRules, validate, submitGuestEnquiry);

// No OTP step — gated by contactToken (proof an earlier /submit call on
// this browser already passed OTP) instead. Deliberately outside
// otpLimiter's 5-per-10-min budget: a visitor who verified once and is
// legitimately browsing several vendor pages in a row shouldn't compete
// with that OTP-request budget; app.js's globalLimiter still bounds it.
router.post('/auto-submit', ...autoSubmitEnquiryRules, validate, autoSubmitEnquiry);

module.exports = router;
