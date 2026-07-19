const NewsletterSubscriber = require('../models/NewsletterSubscriber.model');
const catchAsync = require('../utils/catchAsync');
const { success } = require('../utils/apiResponse');

const subscribe = catchAsync(async (req, res) => {
  const { email, source } = req.body;

  const existing = await NewsletterSubscriber.findOne({ email });
  if (!existing) {
    await NewsletterSubscriber.create({ email, source: source || 'footer' });
  }

  return success(res, {}, 'Subscribed successfully.', 201);
});

module.exports = { subscribe };
