const { body } = require('express-validator');

const createLeadRules = [
  body('vendorId').isMongoId().withMessage('Valid vendorId is required'),
  body('projectType').trim().notEmpty().withMessage('Project type is required'),
  body('budget').trim().notEmpty().withMessage('Budget range is required'),
  body('city').trim().notEmpty().withMessage('City is required'),
  body('requirements').optional().trim(),
];

const updateStatusRules = [
  body('status')
    .isIn(['contacted', 'quotation_sent', 'won', 'lost'])
    .withMessage('Invalid status. Must be one of: contacted, quotation_sent, won, lost'),
];

module.exports = { createLeadRules, updateStatusRules };
