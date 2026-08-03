const { body } = require('express-validator');

const updateProfileRules = [
  body('businessName').optional().trim().notEmpty().withMessage('Business name cannot be empty'),
  body('description').optional().trim(),
  body('profilePhoto').optional({ checkFalsy: true }).isURL().withMessage('profilePhoto must be a valid URL'),
  body('specializations').optional().isArray().withMessage('Specializations must be an array'),
  body('experienceYears')
    .optional({ checkFalsy: true })
    .isInt({ min: 0, max: 80 })
    .withMessage('Years of experience must be a whole number between 0 and 80'),
  body('services').optional().isArray().withMessage('Services must be an array'),
  body('services.*.name').trim().notEmpty().withMessage('Each service needs a name'),
  // checkFalsy so an empty string (not just an absent field) is treated as
  // "not provided" and skips notEmpty() — without it, .optional() only skips
  // undefined, so a vendor with a genuinely blank business address (e.g. one
  // who's only filled in serviceLocations) gets rejected with "cannot be
  // empty" on every save. Same fix already applied to location.pincode below.
  body('location.city').optional({ checkFalsy: true }).trim().notEmpty().withMessage('City cannot be empty'),
  body('location.state').optional({ checkFalsy: true }).trim().notEmpty().withMessage('State cannot be empty'),
  body('location.pincode')
    .optional({ checkFalsy: true })
    .matches(/^\d{6}$/)
    .withMessage('Pincode must be 6 digits'),
  body('serviceLocations').optional().isArray().withMessage('Service locations must be an array'),
  body('serviceLocations.*.city').trim().notEmpty().withMessage('Each service location needs a city'),
  body('serviceLocations.*.state').trim().notEmpty().withMessage('Each service location needs a state'),
  body('serviceLocations.*.pincode')
    .optional({ checkFalsy: true })
    .matches(/^\d{6}$/)
    .withMessage('Each service location pincode must be 6 digits'),
];

module.exports = { updateProfileRules };
