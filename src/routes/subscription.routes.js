const express = require('express');
const { getPlans, createOrder, verifyPayment, getMyPlan } = require('../controllers/subscription.controller');
const { protect } = require('../middleware/auth');
const rbac = require('../middleware/rbac');

const router = express.Router();

router.get('/plans',           getPlans);
router.post('/create-order',   protect, rbac('vendor'), createOrder);
router.post('/verify-payment', protect, rbac('vendor'), verifyPayment);
router.get('/my-plan',         protect, rbac('vendor'), getMyPlan);

module.exports = router;
