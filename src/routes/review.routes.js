const express = require('express');
const { createReview, getVendorReviews } = require('../controllers/review.controller');
const { protect } = require('../middleware/auth');
const rbac = require('../middleware/rbac');

const router = express.Router();

router.post('/',                          protect, rbac('user'), createReview);
router.get('/vendor/:vendorId',           getVendorReviews);

module.exports = router;
