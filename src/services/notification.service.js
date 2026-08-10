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

    // This notifies the VENDOR that a new lead came in, so it must resolve
    // the vendor's own account (not `user`, the homeowner who submitted the
    // enquiry) for the email/phone — same lookup pattern as
    // SUBSCRIPTION_EXPIRING below. `vendor` (a Vendor doc) has no email/phone
    // fields itself.
    const vendorUser = await User.findById(vendor.userId).select('email phone emailNotifications notificationPreferences');

    if (vendorUser && shouldSendEmail(vendorUser, 'leadAssigned')) {
      await emailService.sendLeadAssignedEmail({
        to: vendorUser.email,
        vendorName: vendor.businessName,
        enquiryId: lead.enquiryId,
        leadId: lead._id,
        projectType: lead.projectType,
        city: lead.city,
        budget: lead.budget,
        contactName: lead.contactName,
        contactPhone: lead.contactPhone,
        contactEmail: lead.contactEmail,
        requirements: lead.requirements,
        isConsultation: lead.isConsultation,
        preferredDate: lead.preferredDate,
      });
    }

    if (vendorUser && shouldSendWhatsapp(vendorUser, 'leadAssigned')) {
      await whatsappService.notifyLeadAssigned({
        phone: vendorUser.phone,
        vendorName: vendor.businessName,
        enquiryId: lead.enquiryId,
        projectType: lead.projectType,
      });
    }
  },

  // Only ever fires for a legacy lead that still has a real userId (see the
  // `if (lead.userId)` guard around this dispatch in acceptLead) — guest
  // enquiries have no User to accept on behalf of. The in-app Notification
  // this used to also create is gone: there's no homeowner dashboard left
  // to view it in (see the homeowner-removal plan, Phases 4-7), so it was
  // pure orphaned data. The email stays — it's still a real, useful message
  // for whichever legacy leads are still active.
  LEAD_ACCEPTED: async ({ user, vendor, lead }) => {
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
    // LEAD_ASSIGNED above.
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

  PROJECT_APPROVED: async ({ vendor, project }) => {
    await Notification.create({
      recipientId: vendor.userId,
      recipientRole: 'vendor',
      type: 'project_approved',
      title: 'Portfolio Project Approved',
      message: `Your project "${project.title}" has been approved and is now visible on your public profile.`,
      channels: ['in_app'],
      metadata: { projectId: project._id },
    });
  },

  PROJECT_REJECTED: async ({ vendor, project }) => {
    await Notification.create({
      recipientId: vendor.userId,
      recipientRole: 'vendor',
      type: 'project_rejected',
      title: 'Portfolio Project Rejected',
      message: `Your project "${project.title}" was rejected: ${project.rejectionReason}`,
      channels: ['in_app'],
      metadata: { projectId: project._id },
    });
  },

  VENDOR_REGISTERED: async ({ vendor, user }) => {
    await Notification.create({
      recipientId: user._id,
      recipientRole: 'vendor',
      type: 'vendor_registered',
      title: 'Welcome to Intrafer',
      message: `Your designer account for "${vendor.businessName}" has been created. Complete your profile to get started.`,
      channels: ['in_app', 'email'],
    });

    // Registration has no opt-out preference to check yet (notificationPreferences
    // only exists for events a vendor can already be receiving), so this always
    // sends — same as sendVendorApprovedEmail, which also isn't gated.
    await emailService.sendVendorWelcomeEmail({
      to: user.email,
      name: user.name,
      businessName: vendor.businessName,
    });
  },

  ONBOARDING_STALLED: async ({ vendor, user }) => {
    await Notification.create({
      recipientId: user._id,
      recipientRole: 'vendor',
      type: 'onboarding_stalled',
      title: "You're almost live",
      message: `"${vendor.businessName}"'s profile is complete — subscribe to a plan to activate your listing and start receiving leads.`,
      channels: ['in_app', 'email'],
    });

    if (shouldSendEmail(user, 'onboardingStalled')) {
      await emailService.sendOnboardingNudgeEmail({
        to: user.email,
        name: user.name,
        businessName: vendor.businessName,
      });
    }
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
