const NewsletterSubscriber = require('../models/NewsletterSubscriber.model');
const catchAsync = require('../utils/catchAsync');
const { success } = require('../utils/apiResponse');
const { isBot } = require('../utils/honeypot');

const subscribe = catchAsync(async (req, res) => {
  const { email, source } = req.body;

  // Honeypot tripped — fake success, no subscriber row created. See
  // src/utils/honeypot.js.
  if (isBot(req)) {
    return success(res, {}, 'Subscribed successfully.', 201);
  }

  const existing = await NewsletterSubscriber.findOne({ email });
  if (!existing) {
    await NewsletterSubscriber.create({ email, source: source || 'footer' });
  }

  return success(res, {}, 'Subscribed successfully.', 201);
});

module.exports = { subscribe };
