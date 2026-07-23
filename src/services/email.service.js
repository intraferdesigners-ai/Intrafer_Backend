const transporter = require('../config/mailer');
const EmailTemplate = require('../models/EmailTemplate.model');
const renderTemplate = require('../utils/renderTemplate');

// Looks up the active EmailTemplate for `key` and renders it against
// `variables`. Falls back to the given hardcoded subject/html untouched if no
// active template exists yet (not seeded, deactivated, or the lookup itself
// fails) — this is the safety net that keeps every send working before
// scripts/seedEmailTemplates.js has run, or if a template is ever deleted.
const resolveTemplate = async (key, variables, fallbackSubject, fallbackHtml) => {
  try {
    const template = await EmailTemplate.findOne({ key, isActive: true });
    if (template) {
      return {
        subject: renderTemplate(template.subject, variables),
        html: renderTemplate(template.htmlBody, variables),
      };
    }
  } catch (err) {
    console.error(`[EmailTemplate] Lookup failed for "${key}":`, err.message);
  }
  return { subject: fallbackSubject, html: fallbackHtml };
};

const sendOTPEmail = async ({ to, name, otp }) => {
  const from = `"${process.env.FROM_NAME}" <${process.env.FROM_EMAIL}>`;

  const fallbackSubject = 'Your Intrafer Verification Code';
  const fallbackHtml = `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px;background:#fff;">
        <h2 style="color:#1A56B0;margin-bottom:8px;">Intrafer</h2>
        <p style="font-size:16px;color:#333;">Hi ${name},</p>
        <p style="font-size:15px;color:#555;">Use the code below to verify your account:</p>
        <div style="text-align:center;margin:32px 0;">
          <span style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#1A56B0;">${otp}</span>
        </div>
        <p style="font-size:13px;color:#888;">This code expires in <strong>10 minutes</strong>.</p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
        <p style="font-size:12px;color:#aaa;">If you didn't request this, ignore this email.</p>
      </div>
    `;

  const { subject, html } = await resolveTemplate('otp_verification', { name, otp }, fallbackSubject, fallbackHtml);
  await transporter.sendMail({ from, to, subject, html });
};

const sendLeadAssignedEmail = async ({ to, vendorName, enquiryId, projectType, city, budget }) => {
  const from = `"${process.env.FROM_NAME}" <${process.env.FROM_EMAIL}>`;
  const dashboardUrl = `${process.env.CLIENT_URL}/vendor/dashboard/leads`;

  const fallbackSubject = `New Lead Assigned — ${enquiryId}`;
  const fallbackHtml = `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px;background:#fff;">
        <h2 style="color:#1A56B0;margin-bottom:8px;">Intrafer</h2>
        <p style="font-size:16px;color:#333;">Hi ${vendorName},</p>
        <p style="font-size:15px;color:#555;">You have been assigned a new lead. Here are the details:</p>
        <table style="width:100%;border-collapse:collapse;margin:24px 0;font-size:14px;">
          <tr style="background:#f5f8ff;">
            <td style="padding:10px 14px;font-weight:bold;color:#444;border:1px solid #e0e7ef;">Enquiry ID</td>
            <td style="padding:10px 14px;color:#333;border:1px solid #e0e7ef;">${enquiryId}</td>
          </tr>
          <tr>
            <td style="padding:10px 14px;font-weight:bold;color:#444;border:1px solid #e0e7ef;">Project Type</td>
            <td style="padding:10px 14px;color:#333;border:1px solid #e0e7ef;">${projectType}</td>
          </tr>
          <tr style="background:#f5f8ff;">
            <td style="padding:10px 14px;font-weight:bold;color:#444;border:1px solid #e0e7ef;">City</td>
            <td style="padding:10px 14px;color:#333;border:1px solid #e0e7ef;">${city}</td>
          </tr>
          <tr>
            <td style="padding:10px 14px;font-weight:bold;color:#444;border:1px solid #e0e7ef;">Budget</td>
            <td style="padding:10px 14px;color:#333;border:1px solid #e0e7ef;">${budget}</td>
          </tr>
        </table>
        <div style="text-align:center;margin:32px 0;">
          <a href="${dashboardUrl}" style="background:#1A56B0;color:#fff;text-decoration:none;padding:12px 28px;border-radius:6px;font-size:15px;font-weight:bold;">View Lead</a>
        </div>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
        <p style="font-size:12px;color:#aaa;">You are receiving this because you are a registered vendor on Intrafer.</p>
      </div>
    `;

  const { subject, html } = await resolveTemplate(
    'lead_assigned',
    { vendorName, enquiryId, projectType, city, budget, dashboardUrl },
    fallbackSubject,
    fallbackHtml
  );
  await transporter.sendMail({ from, to, subject, html });
};

const sendLeadAcceptedEmail = async ({ to, userName, vendorName, enquiryId, projectType }) => {
  const from = `"${process.env.FROM_NAME}" <${process.env.FROM_EMAIL}>`;
  const dashboardUrl = `${process.env.CLIENT_URL}/user/dashboard/enquiries`;

  const fallbackSubject = `Your enquiry has been accepted — ${enquiryId}`;
  const fallbackHtml = `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px;background:#fff;">
        <h2 style="color:#1A56B0;margin-bottom:8px;">Intrafer</h2>
        <p style="font-size:16px;color:#333;">Hi ${userName},</p>
        <p style="font-size:15px;color:#555;">
          Good news! <strong>${vendorName}</strong> has accepted your enquiry <strong>${enquiryId}</strong> for <strong>${projectType}</strong> and will contact you shortly.
        </p>
        <div style="text-align:center;margin:32px 0;">
          <a href="${dashboardUrl}" style="background:#1A56B0;color:#fff;text-decoration:none;padding:12px 28px;border-radius:6px;font-size:15px;font-weight:bold;">View Enquiry</a>
        </div>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
        <p style="font-size:12px;color:#aaa;">You are receiving this because you submitted an enquiry on Intrafer.</p>
      </div>
    `;

  const { subject, html } = await resolveTemplate(
    'lead_accepted',
    { userName, vendorName, enquiryId, projectType, dashboardUrl },
    fallbackSubject,
    fallbackHtml
  );
  await transporter.sendMail({ from, to, subject, html });
};

const sendLeadCancelledEmail = async ({ to, vendorName, userName, enquiryId, projectType }) => {
  const from = `"${process.env.FROM_NAME}" <${process.env.FROM_EMAIL}>`;
  const dashboardUrl = `${process.env.CLIENT_URL}/vendor/dashboard/leads`;

  const fallbackSubject = `Enquiry cancelled — ${enquiryId}`;
  const fallbackHtml = `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px;background:#fff;">
        <h2 style="color:#1A56B0;margin-bottom:8px;">Intrafer</h2>
        <p style="font-size:16px;color:#333;">Hi ${vendorName},</p>
        <p style="font-size:15px;color:#555;">
          <strong>${userName}</strong> has cancelled their enquiry <strong>${enquiryId}</strong> for <strong>${projectType}</strong>.
        </p>
        <div style="text-align:center;margin:32px 0;">
          <a href="${dashboardUrl}" style="background:#1A56B0;color:#fff;text-decoration:none;padding:12px 28px;border-radius:6px;font-size:15px;font-weight:bold;">View Leads</a>
        </div>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
        <p style="font-size:12px;color:#aaa;">You are receiving this because you are a registered vendor on Intrafer.</p>
      </div>
    `;

  const { subject, html } = await resolveTemplate(
    'lead_cancelled',
    { vendorName, userName, enquiryId, projectType, dashboardUrl },
    fallbackSubject,
    fallbackHtml
  );
  await transporter.sendMail({ from, to, subject, html });
};

const sendAppointmentConfirmedEmail = async ({ to, userName, vendorName, formattedDateTime }) => {
  const from = `"${process.env.FROM_NAME}" <${process.env.FROM_EMAIL}>`;

  const fallbackSubject = 'Your consultation appointment is confirmed — Intrafer';
  const fallbackHtml = `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px;background:#fff;">
        <h2 style="color:#1A56B0;margin-bottom:8px;">Intrafer</h2>
        <p style="font-size:16px;color:#333;">Hi ${userName},</p>
        <p style="font-size:15px;color:#555;">
          <strong>${vendorName}</strong> has confirmed your consultation appointment for <strong>${formattedDateTime}</strong>.
        </p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
        <p style="font-size:12px;color:#aaa;">You are receiving this because you booked a consultation on Intrafer.</p>
      </div>
    `;

  const { subject, html } = await resolveTemplate(
    'appointment_confirmed',
    { userName, vendorName, formattedDateTime },
    fallbackSubject,
    fallbackHtml
  );
  await transporter.sendMail({ from, to, subject, html });
};

const sendSubscriptionConfirmEmail = async ({ to, vendorName, planName, endDate }) => {
  const from = `"${process.env.FROM_NAME}" <${process.env.FROM_EMAIL}>`;
  const formattedDate = new Date(endDate).toLocaleDateString('en-IN');

  const fallbackSubject = 'Subscription Activated — Intrafer';
  const fallbackHtml = `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px;background:#fff;">
        <h2 style="color:#1A56B0;margin-bottom:8px;">Intrafer</h2>
        <p style="font-size:16px;color:#333;">Hi ${vendorName},</p>
        <p style="font-size:15px;color:#555;">
          Your <strong>${planName}</strong> subscription has been successfully activated.
        </p>
        <p style="font-size:15px;color:#555;">
          Your plan is valid until <strong>${formattedDate}</strong>.
        </p>
        <p style="font-size:15px;color:#2e7d32;font-weight:bold;">Your listing is now live on Intrafer!</p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
        <p style="font-size:12px;color:#aaa;">Thank you for choosing Intrafer to grow your interior design business.</p>
      </div>
    `;

  const { subject, html } = await resolveTemplate(
    'subscription_confirm',
    { vendorName, planName, formattedDate },
    fallbackSubject,
    fallbackHtml
  );
  await transporter.sendMail({ from, to, subject, html });
};

const sendVendorApprovedEmail = async ({ to, name, businessName }) => {
  const from = `"${process.env.FROM_NAME}" <${process.env.FROM_EMAIL}>`;

  const fallbackSubject = 'Your Intrafer listing is approved! 🎉';
  const fallbackHtml = `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px;background:#fff;">
        <h2 style="color:#B5541E;margin-bottom:8px;">Intrafer</h2>
        <h3 style="color:#222;">Congratulations! Your studio is now live.</h3>
        <p style="font-size:15px;color:#333;">Hi ${name},</p>
        <p style="font-size:15px;color:#555;">Your design studio <strong>${businessName}</strong> has been approved and your listing is now live on Intrafer.</p>
        <p style="font-size:15px;color:#555;">To start receiving leads, subscribe to a plan at <a href="https://intrafer.in/vendor/dashboard/subscription" style="color:#B5541E;">Subscription Plans</a></p>
        <p style="font-size:15px;color:#555;">Welcome to the Intrafer designer community!</p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
        <p style="font-size:12px;color:#aaa;">Intrafer — India's interior designer marketplace.</p>
      </div>
    `;

  const { subject, html } = await resolveTemplate('vendor_approved', { name, businessName }, fallbackSubject, fallbackHtml);
  await transporter.sendMail({ from, to, subject, html });
};

const sendVendorRejectedEmail = async ({ to, name, businessName, rejectionReason }) => {
  const from = `"${process.env.FROM_NAME}" <${process.env.FROM_EMAIL}>`;
  const effectiveReason = rejectionReason || 'Please complete your profile and add portfolio photos.';

  const fallbackSubject = 'Update on your Intrafer application';
  const fallbackHtml = `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px;background:#fff;">
        <h2 style="color:#B5541E;margin-bottom:8px;">Intrafer</h2>
        <h3 style="color:#222;">Application update required</h3>
        <p style="font-size:15px;color:#333;">Hi ${name},</p>
        <p style="font-size:15px;color:#555;">Thank you for applying to list <strong>${businessName}</strong> on Intrafer.</p>
        <p style="font-size:15px;color:#555;">We need a few more details before we can approve your listing:</p>
        <blockquote style="border-left:3px solid #B5541E;padding-left:12px;color:#555;margin:16px 0;">
          ${effectiveReason}
        </blockquote>
        <p style="font-size:15px;color:#555;">Log in to complete your profile: <a href="https://intrafer.in/vendor/dashboard/profile" style="color:#B5541E;">Update Profile</a></p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
        <p style="font-size:12px;color:#aaa;">Intrafer — India's interior designer marketplace.</p>
      </div>
    `;

  const { subject, html } = await resolveTemplate(
    'vendor_rejected',
    { name, businessName, rejectionReason: effectiveReason },
    fallbackSubject,
    fallbackHtml
  );
  await transporter.sendMail({ from, to, subject, html });
};

const sendPasswordResetEmail = async ({ to, name, resetUrl }) => {
  const from = `"${process.env.FROM_NAME}" <${process.env.FROM_EMAIL}>`;

  const fallbackSubject = 'Reset your Intrafer password';
  const fallbackHtml = `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px;background:#fff;">
        <h2 style="color:#1A56B0;margin-bottom:8px;">Intrafer</h2>
        <p style="font-size:16px;color:#333;">Hi ${name},</p>
        <p style="font-size:15px;color:#555;">We received a request to reset your Intrafer password. Click the button below to choose a new one:</p>
        <div style="text-align:center;margin:32px 0;">
          <a href="${resetUrl}" style="background:#1A56B0;color:#fff;text-decoration:none;padding:12px 28px;border-radius:6px;font-size:15px;font-weight:bold;">Reset Password</a>
        </div>
        <p style="font-size:13px;color:#888;">This link expires in <strong>30 minutes</strong>.</p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
        <p style="font-size:12px;color:#aaa;">If you didn't request this, you can safely ignore this email — your password will not be changed.</p>
      </div>
    `;

  const { subject, html } = await resolveTemplate('password_reset', { name, resetUrl }, fallbackSubject, fallbackHtml);
  await transporter.sendMail({ from, to, subject, html });
};

const sendSupportTicketConfirmationEmail = async ({ to, name, subject: ticketSubject, message }) => {
  const from = `"${process.env.FROM_NAME}" <${process.env.FROM_EMAIL}>`;

  const fallbackSubject = `We've received your message — Intrafer Support`;
  const fallbackHtml = `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px;background:#fff;">
        <h2 style="color:#1A56B0;margin-bottom:8px;">Intrafer</h2>
        <p style="font-size:16px;color:#333;">Hi ${name},</p>
        <p style="font-size:15px;color:#555;">Thanks for reaching out. We've received your message and our support team will get back to you within 24 hours.</p>
        <table style="width:100%;border-collapse:collapse;margin:24px 0;font-size:14px;">
          <tr style="background:#f5f8ff;">
            <td style="padding:10px 14px;font-weight:bold;color:#444;border:1px solid #e0e7ef;">Subject</td>
            <td style="padding:10px 14px;color:#333;border:1px solid #e0e7ef;">${ticketSubject}</td>
          </tr>
          <tr>
            <td style="padding:10px 14px;font-weight:bold;color:#444;border:1px solid #e0e7ef;vertical-align:top;">Message</td>
            <td style="padding:10px 14px;color:#333;border:1px solid #e0e7ef;">${message}</td>
          </tr>
        </table>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
        <p style="font-size:12px;color:#aaa;">If you have more details to add, just reply to this email.</p>
      </div>
    `;

  const { subject, html } = await resolveTemplate(
    'support_ticket_confirmation',
    { name, subject: ticketSubject, message },
    fallbackSubject,
    fallbackHtml
  );
  await transporter.sendMail({ from, to, subject, html });
};

module.exports = {
  sendOTPEmail, sendLeadAssignedEmail, sendLeadAcceptedEmail, sendLeadCancelledEmail, sendAppointmentConfirmedEmail, sendSubscriptionConfirmEmail,
  sendVendorApprovedEmail, sendVendorRejectedEmail, sendPasswordResetEmail, sendSupportTicketConfirmationEmail,
};
