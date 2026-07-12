const success = (res, data = {}, message = 'Success', statusCode = 200) => {
  return res.status(statusCode).json({ success: true, message, data });
};

const error = (res, message = 'Something went wrong', statusCode = 500, errors) => {
  const body = { success: false, message };
  if (errors !== undefined) body.errors = errors;
  return res.status(statusCode).json(body);
};

module.exports = { success, error };
