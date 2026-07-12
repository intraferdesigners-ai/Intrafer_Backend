const jwt = require('jsonwebtoken');
const User = require('../models/User.model');
const catchAsync = require('../utils/catchAsync');
const { error } = require('../utils/apiResponse');

const protect = catchAsync(async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return error(res, 'Not authenticated. Please log in.', 401);
  }

  const token = authHeader.split(' ')[1];
  const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);

  const user = await User.findById(decoded.id).select('-passwordHash -refreshToken -otp');
  if (!user) {
    return error(res, 'User no longer exists.', 401);
  }

  req.user = user;
  next();
});

module.exports = { protect };
