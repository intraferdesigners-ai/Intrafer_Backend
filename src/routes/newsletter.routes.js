const express = require('express');
const { subscribe } = require('../controllers/newsletter.controller');
const { newsletterLimiter } = require('../middleware/rateLimiter');
const validate = require('../middleware/validate');
const { subscribeRules } = require('../validators/newsletter.validator');

const router = express.Router();

router.post('/subscribe', newsletterLimiter, ...subscribeRules, validate, subscribe);

module.exports = router;
