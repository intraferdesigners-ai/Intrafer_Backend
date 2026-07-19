const { body } = require('express-validator');

const subscribeRules = [
  body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
];

module.exports = { subscribeRules };
