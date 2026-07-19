const { body } = require('express-validator');

const updateProfileRules = [
  body('businessName').optional().trim().notEmpty().withMessage('Business name cannot be empty'),
  body('description').optional().trim(),
  body('profilePhoto').optional({ checkFalsy: true }).isURL().withMessage('profilePhoto must be a valid URL'),
  body('specializations').optional().isArray().withMessage('Specializations must be an array'),
  body('services').optional().isArray().withMessage('Services must be an array'),
  body('services.*.name').trim().notEmpty().withMessage('Each service needs a name'),
  body('location.city').optional().trim().notEmpty().withMessage('City cannot be empty'),
  body('location.state').optional().trim().notEmpty().withMessage('State cannot be empty'),
  body('location.pincode')
    .optional()
    .matches(/^\d{6}$/)
    .withMessage('Pincode must be 6 digits'),
];

module.exports = { updateProfileRules };
