const Notification = require('../models/Notification.model');
const emailService = require('./email.service');
const whatsappService = require('./whatsapp.service');

const handlers = {
  LEAD_ASSIGNED: async ({ vendor, user, lead }) => {
    await Notification.create({
      recipientId: vendor.userId,
      recipientRole: 'vendor',
      type: 'lead_assigned',
      title: 'New Lead Assigned',
      message: `New enquiry ${lead.enquiryId} for ${lead.projectType} in ${lead.city}.`,
      channels: ['in_app', 'email', 'whatsapp'],
      metadata: { leadId: lead._id },
    });

    await emailService.sendLeadAssignedEmail({
      to: user.email,
      vendorName: vendor.businessName,
      enquiryId: lead.enquiryId,
      projectType: lead.projectType,
      city: lead.city,
      budget: lead.budget,
    });

    await whatsappService.notifyLeadAssigned({
      phone: user.phone,
      vendorName: vendor.businessName,
      enquiryId: lead.enquiryId,
      projectType: lead.projectType,
    });
  },

  LEAD_ACCEPTED: async ({ user, vendor, lead }) => {
    await Notification.create({
      recipientId: user._id,
      recipientRole: 'user',
      type: 'lead_accepted',
      title: 'Vendor Accepted Your Enquiry',
      message: `${vendor.businessName} has accepted your enquiry ${lead.enquiryId} and will contact you shortly.`,
      channels: ['in_app', 'email'],
    });
  },

  PAYMENT_SUCCESS: async ({ vendor, subscription, vendorEmail }) => {
    const formattedDate = new Date(subscription.endDate).toLocaleDateString('en-IN');

    await Notification.create({
      recipientId: vendor.userId,
      recipientRole: 'vendor',
      type: 'payment_success',
      title: 'Subscription Activated',
      message: `Your ${subscription.planName} plan is now active until ${formattedDate}.`,
      channels: ['in_app', 'email'],
    });

    await emailService.sendSubscriptionConfirmEmail({
      to: vendorEmail,
      vendorName: vendor.businessName,
      planName: subscription.planName,
      endDate: subscription.endDate,
    });
  },
};

const dispatch = async (event, payload) => {
  const handler = handlers[event];
  if (!handler) {
    console.warn(`[Notification] Unrecognised event: ${event}`);
    return;
  }
  try {
    await handler(payload);
  } catch (err) {
    console.error(`[Notification] Event ${event} failed: ${err.message}`);
  }
};

module.exports = { dispatch };
