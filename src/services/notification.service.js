const Notification = require('../models/Notification.model');
const User = require('../models/User.model');
const emailService = require('./email.service');
const whatsappService = require('./whatsapp.service');

function shouldSendEmail(user, eventKey) {
  const pref = user.notificationPreferences?.[eventKey]?.email;
  return pref !== undefined ? pref : (user.emailNotifications !== false);
}
function shouldSendWhatsapp(user, eventKey) {
  const pref = user.notificationPreferences?.[eventKey]?.whatsapp;
  return pref !== undefined ? pref : true;
}

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

    if (shouldSendEmail(user, 'leadAssigned')) {
      await emailService.sendLeadAssignedEmail({
        to: user.email,
        vendorName: vendor.businessName,
        enquiryId: lead.enquiryId,
        projectType: lead.projectType,
        city: lead.city,
        budget: lead.budget,
      });
    }

    if (shouldSendWhatsapp(user, 'leadAssigned')) {
      await whatsappService.notifyLeadAssigned({
        phone: user.phone,
        vendorName: vendor.businessName,
        enquiryId: lead.enquiryId,
        projectType: lead.projectType,
      });
    }
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

    if (shouldSendEmail(user, 'leadAccepted')) {
      await emailService.sendLeadAcceptedEmail({
        to: user.email,
        userName: user.name,
        vendorName: vendor.businessName,
        enquiryId: lead.enquiryId,
        projectType: lead.projectType,
      });
    }
  },

  LEAD_CANCELLED: async ({ vendor, user, lead }) => {
    await Notification.create({
      recipientId: vendor.userId,
      recipientRole: 'vendor',
      type: 'lead_cancelled',
      title: 'Enquiry Cancelled',
      message: `${user.name} cancelled their enquiry ${lead.enquiryId} for ${lead.projectType}.`,
      channels: ['in_app', 'email'],
      metadata: { leadId: lead._id },
    });

    const vendorUser = await User.findById(vendor.userId).select('email emailNotifications notificationPreferences');
    if (vendorUser && shouldSendEmail(vendorUser, 'leadCancelled')) {
      await emailService.sendLeadCancelledEmail({
        to: vendorUser.email,
        vendorName: vendor.businessName,
        userName: user.name,
        enquiryId: lead.enquiryId,
        projectType: lead.projectType,
      });
    }
  },

  APPOINTMENT_CONFIRMED: async ({ user, vendor, lead }) => {
    const formattedDateTime = new Date(lead.confirmedDateTime).toLocaleString('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });

    await Notification.create({
      recipientId: user._id,
      recipientRole: 'user',
      type: 'appointment_confirmed',
      title: 'Consultation Appointment Confirmed',
      message: `${vendor.businessName} confirmed your consultation for ${formattedDateTime}.`,
      channels: ['in_app', 'email'],
      metadata: { leadId: lead._id },
    });

    if (shouldSendEmail(user, 'appointmentConfirmed')) {
      await emailService.sendAppointmentConfirmedEmail({
        to: user.email,
        userName: user.name,
        vendorName: vendor.businessName,
        formattedDateTime,
      });
    }
  },

  NEW_MESSAGE: async ({ recipientId, recipientRole, senderName, lead }) => {
    await Notification.create({
      recipientId,
      recipientRole,
      type: 'new_message',
      title: 'New Message',
      message: `${senderName} sent you a message about enquiry ${lead.enquiryId}.`,
      channels: ['in_app'],
      metadata: { leadId: lead._id },
    });
  },

  SUPPORT_TICKET_CREATED: async ({ ticket }) => {
    const admins = await User.find({ role: 'admin' }).select('_id');
    await Promise.all(admins.map((admin) =>
      Notification.create({
        recipientId: admin._id,
        recipientRole: 'admin',
        type: 'support_ticket_created',
        title: 'New Support Ticket',
        message: `${ticket.name} submitted a ticket: "${ticket.subject}".`,
        channels: ['in_app'],
        metadata: { ticketId: ticket._id },
      })
    ));

    await emailService.sendSupportTicketConfirmationEmail({
      to: ticket.email,
      name: ticket.name,
      subject: ticket.subject,
      message: ticket.message,
    });
  },

  VENDOR_APPROVED: async ({ vendor }) => {
    // Email is already sent separately by approveVendor itself — this only
    // creates the in-app record. 'email' still appears in channels since one
    // is genuinely sent, just not from here.
    await Notification.create({
      recipientId: vendor.userId._id || vendor.userId,
      recipientRole: 'vendor',
      type: 'vendor_approved',
      title: 'Your profile has been approved',
      message: `Congratulations! Your designer profile "${vendor.businessName}" is now live on Intrafer.`,
      channels: ['in_app', 'email'],
    });
  },

  SUBSCRIPTION_EXPIRING: async ({ vendor, user, subscription }) => {
    const formattedDate = new Date(subscription.endDate).toLocaleDateString('en-IN');

    await Notification.create({
      recipientId: user._id,
      recipientRole: 'vendor',
      type: 'subscription_expiring',
      title: 'Your subscription is expiring soon',
      message: `Your ${subscription.planName} plan expires on ${formattedDate}. Renew now to keep your listing live.`,
      channels: ['in_app', 'email'],
      metadata: { subscriptionId: subscription._id },
    });

    // Fetched separately (rather than trusting the job's own populate) so the
    // notification-preference fields are always fresh, same pattern as
    // LEAD_CANCELLED above.
    const vendorUser = await User.findById(user._id).select('email emailNotifications notificationPreferences').lean();
    if (vendorUser && shouldSendEmail(vendorUser, 'subscriptionExpiring')) {
      await emailService.sendSubscriptionExpiringEmail({
        to: vendorUser.email,
        vendorName: vendor.businessName,
        planName: subscription.planName,
        formattedDate,
      });
    }
  },

  ENQUIRY_CREATED: async ({ user, vendor, lead }) => {
    await Notification.create({
      recipientId: user._id,
      recipientRole: 'user',
      type: 'enquiry_created',
      title: 'Enquiry Submitted',
      message: `Your enquiry ${lead.enquiryId} for ${lead.projectType} has been sent to ${vendor.businessName}.`,
      channels: ['in_app'],
      metadata: { leadId: lead._id },
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

    const vendorUser = await User.findById(vendor.userId).select('emailNotifications notificationPreferences');
    if (vendorUser && shouldSendEmail(vendorUser, 'paymentSuccess')) {
      await emailService.sendSubscriptionConfirmEmail({
        to: vendorEmail,
        vendorName: vendor.businessName,
        planName: subscription.planName,
        endDate: subscription.endDate,
      });
    }
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

module.exports = { dispatch, shouldSendEmail, shouldSendWhatsapp };
