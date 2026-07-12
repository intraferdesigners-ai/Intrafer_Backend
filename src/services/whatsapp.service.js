const waClient = require('../config/whatsapp');

const sendTemplate = async ({ to, templateName, components }) => {
  try {
    await waClient.post('/messages', {
      messaging_product: 'whatsapp',
      to: `91${to}`,
      type: 'template',
      template: {
        name: templateName,
        language: { code: 'en' },
        components,
      },
    });
  } catch (err) {
    console.error('[WhatsApp] Failed:', err.message);
  }
};

const notifyLeadAssigned = ({ phone, vendorName, enquiryId, projectType }) => {
  return sendTemplate({
    to: phone,
    templateName: 'lead_assigned',
    components: [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: vendorName },
          { type: 'text', text: enquiryId },
          { type: 'text', text: projectType },
        ],
      },
    ],
  });
};

module.exports = { sendTemplate, notifyLeadAssigned };
