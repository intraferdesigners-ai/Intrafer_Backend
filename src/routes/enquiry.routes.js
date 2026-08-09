const express = require('express');
const { sendEnquiryOTP, submitGuestEnquiry } = require('../controllers/enquiry.controller');
const validate = require('../middleware/validate');
const { otpLimiter } = require('../middleware/rateLimiter');
const { sendEnquiryOtpRules, submitGuestEnquiryRules } = require('../validators/enquiry.validator');

const router = express.Router();

// Guest-only OTP + lead submission for the public "Submit enquiry" flow —
// never touches the User collection, never issues a session. See
// enquiry.controller.js. Same otpLimiter budget (5 per 10 min) as the
// homeowner/vendor OTP endpoints in auth.routes.js.
router.post('/send-otp', otpLimiter, ...sendEnquiryOtpRules, validate, sendEnquiryOTP);
router.post('/submit', otpLimiter, ...submitGuestEnquiryRules, validate, submitGuestEnquiry);

module.exports = router;
