const axios = require('axios');

const RESEND_API_URL = 'https://api.resend.com/emails';

// Drop-in replacement for the old nodemailer transporter.
// Raw SMTP is blocked on Railway's network (outbound SMTP ports are
// filtered), so we send via Resend's HTTPS API instead. Keeping the
// same sendMail({ from, to, subject, html }) shape means callers in
// email.service.js don't need to change.
const transporter = {
  sendMail: async ({ from, to, subject, html }) => {
    try {
      const response = await axios.post(
        RESEND_API_URL,
        { from, to, subject, html },
        {
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        }
      );
      return response.data;
    } catch (err) {
      const detail = err.response?.data || err.message;
      throw new Error(`Resend API error: ${JSON.stringify(detail)}`);
    }
  },
};

module.exports = transporter;
