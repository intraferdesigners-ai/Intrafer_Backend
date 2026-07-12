const { error } = require('../utils/apiResponse');

const errorHandler = (err, req, res, next) => {
  if (process.env.NODE_ENV === 'development') {
    console.error(err.stack);
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    return error(res, `${field} already in use`, 409);
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const message = Object.values(err.errors)
      .map((e) => e.message)
      .join(', ');
    return error(res, message, 400);
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return error(res, 'Invalid token', 401);
  }
  if (err.name === 'TokenExpiredError') {
    return error(res, 'Token expired. Please log in again', 401);
  }

  // All others
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';
  return error(res, message, statusCode);
};

module.exports = errorHandler;
