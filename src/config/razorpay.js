const Razorpay = require('razorpay');

let _instance = null;

const getRazorpay = () => {
  if (!_instance) {
    _instance = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
  }
  return _instance;
};

module.exports = getRazorpay;
