const express = require('express');
const { getReviewInvite, submitReviewViaToken, getVendorReviews } = require('../controllers/review.controller');
const { authLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

// Public, token-gated — replaces the old session-based `POST /` (protect +
// rbac('user')). There's no logged-in homeowner left to authorise via a
// session; the raw token in the URL (emailed on a lead's 'won' transition,
// see lead.controller.js) is the authorisation. Same authLimiter budget as
// auth/reset-password, the closest existing analogue (public, token-gated,
// mutates state). See the homeowner-removal plan, Phase 0/7.
router.get('/invite/:token',    authLimiter, getReviewInvite);
router.post('/invite/:token',   authLimiter, submitReviewViaToken);
router.get('/vendor/:vendorId', getVendorReviews);

module.exports = router;
