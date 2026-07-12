const axios = require('axios');

const whatsapp = axios.create({
  baseURL: `${process.env.WHATSAPP_API_URL}/${process.env.WHATSAPP_PHONE_ID}`,
  headers: {
    Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
    'Content-Type': 'application/json',
  },
});

module.exports = whatsapp;
