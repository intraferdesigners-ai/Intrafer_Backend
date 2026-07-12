const { validationResult } = require('express-validator');
const { error } = require('../utils/apiResponse');

const validate = (req, res, next) => {
  const result = validationResult(req);
  if (!result.isEmpty()) {
    const errors = result.array().map((e) => ({ field: e.path, message: e.msg }));
    return error(res, 'Validation failed', 400, errors);
  }
  next();
};

module.exports = validate;
