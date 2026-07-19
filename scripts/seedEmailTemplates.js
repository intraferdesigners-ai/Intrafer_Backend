const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const EmailTemplate = require('../src/models/EmailTemplate.model');

// Exact subject lines and HTML bodies currently hardcoded in
// src/services/email.service.js, with each function's interpolated
// ${value} converted to a {{value}} placeholder.
const TEMPLATES = [
  {
    key: 'otp_verification',
    name: 'OTP Verification Email',
    subject: 'Your Intrafer Verification Code',
    htmlBody: `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px;background:#fff;">
        <h2 style="color:#1A56B0;margin-bottom:8px;">Intrafer</h2>
        <p style="font-size:16px;color:#333;">Hi {{name}},</p>
        <p style="font-size:15px;color:#555;">Use the code below to verify your account:</p>
        <div style="text-align:center;margin:32px 0;">
          <span style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#1A56B0;">{{otp}}</span>
        </div>
        <p style="font-size:13px;color:#888;">This code expires in <strong>10 minutes</strong>.</p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
        <p style="font-size:12px;color:#aaa;">If you didn't request this, ignore this email.</p>
      </div>
    `,
    availableVariables: ['name', 'otp'],
  },
  {
    key: 'lead_assigned',
    name: 'Lead Assigned Email',
    subject: 'New Lead Assigned — {{enquiryId}}',
    htmlBody: `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px;background:#fff;">
        <h2 style="color:#1A56B0;margin-bottom:8px;">Intrafer</h2>
        <p style="font-size:16px;color:#333;">Hi {{vendorName}},</p>
        <p style="font-size:15px;color:#555;">You have been assigned a new lead. Here are the details:</p>
        <table style="width:100%;border-collapse:collapse;margin:24px 0;font-size:14px;">
          <tr style="background:#f5f8ff;">
            <td style="padding:10px 14px;font-weight:bold;color:#444;border:1px solid #e0e7ef;">Enquiry ID</td>
            <td style="padding:10px 14px;color:#333;border:1px solid #e0e7ef;">{{enquiryId}}</td>
          </tr>
          <tr>
            <td style="padding:10px 14px;font-weight:bold;color:#444;border:1px solid #e0e7ef;">Project Type</td>
            <td style="padding:10px 14px;color:#333;border:1px solid #e0e7ef;">{{projectType}}</td>
          </tr>
          <tr style="background:#f5f8ff;">
            <td style="padding:10px 14px;font-weight:bold;color:#444;border:1px solid #e0e7ef;">City</td>
            <td style="padding:10px 14px;color:#333;border:1px solid #e0e7ef;">{{city}}</td>
          </tr>
          <tr>
            <td style="padding:10px 14px;font-weight:bold;color:#444;border:1px solid #e0e7ef;">Budget</td>
            <td style="padding:10px 14px;color:#333;border:1px solid #e0e7ef;">{{budget}}</td>
          </tr>
        </table>
        <div style="text-align:center;margin:32px 0;">
          <a href="{{dashboardUrl}}" style="background:#1A56B0;color:#fff;text-decoration:none;padding:12px 28px;border-radius:6px;font-size:15px;font-weight:bold;">View Lead</a>
        </div>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
        <p style="font-size:12px;color:#aaa;">You are receiving this because you are a registered vendor on Intrafer.</p>
      </div>
    `,
    availableVariables: ['vendorName', 'enquiryId', 'projectType', 'city', 'budget', 'dashboardUrl'],
  },
  {
    key: 'subscription_confirm',
    name: 'Subscription Confirmation Email',
    subject: 'Subscription Activated — Intrafer',
    htmlBody: `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px;background:#fff;">
        <h2 style="color:#1A56B0;margin-bottom:8px;">Intrafer</h2>
        <p style="font-size:16px;color:#333;">Hi {{vendorName}},</p>
        <p style="font-size:15px;color:#555;">
          Your <strong>{{planName}}</strong> subscription has been successfully activated.
        </p>
        <p style="font-size:15px;color:#555;">
          Your plan is valid until <strong>{{formattedDate}}</strong>.
        </p>
        <p style="font-size:15px;color:#2e7d32;font-weight:bold;">Your listing is now live on Intrafer!</p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
        <p style="font-size:12px;color:#aaa;">Thank you for choosing Intrafer to grow your interior design business.</p>
      </div>
    `,
    availableVariables: ['vendorName', 'planName', 'formattedDate'],
  },
  {
    key: 'vendor_approved',
    name: 'Vendor Approved Email',
    subject: 'Your Intrafer listing is approved! 🎉',
    htmlBody: `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px;background:#fff;">
        <h2 style="color:#B5541E;margin-bottom:8px;">Intrafer</h2>
        <h3 style="color:#222;">Congratulations! Your studio is now live.</h3>
        <p style="font-size:15px;color:#333;">Hi {{name}},</p>
        <p style="font-size:15px;color:#555;">Your design studio <strong>{{businessName}}</strong> has been approved and your listing is now live on Intrafer.</p>
        <p style="font-size:15px;color:#555;">To start receiving leads, subscribe to a plan at <a href="https://intrafer.in/vendor/dashboard/subscription" style="color:#B5541E;">Subscription Plans</a></p>
        <p style="font-size:15px;color:#555;">Welcome to the Intrafer designer community!</p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
        <p style="font-size:12px;color:#aaa;">Intrafer — India's interior designer marketplace.</p>
      </div>
    `,
    availableVariables: ['name', 'businessName'],
  },
  {
    key: 'vendor_rejected',
    name: 'Vendor Rejected Email',
    subject: 'Update on your Intrafer application',
    htmlBody: `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px;background:#fff;">
        <h2 style="color:#B5541E;margin-bottom:8px;">Intrafer</h2>
        <h3 style="color:#222;">Application update required</h3>
        <p style="font-size:15px;color:#333;">Hi {{name}},</p>
        <p style="font-size:15px;color:#555;">Thank you for applying to list <strong>{{businessName}}</strong> on Intrafer.</p>
        <p style="font-size:15px;color:#555;">We need a few more details before we can approve your listing:</p>
        <blockquote style="border-left:3px solid #B5541E;padding-left:12px;color:#555;margin:16px 0;">
          {{rejectionReason}}
        </blockquote>
        <p style="font-size:15px;color:#555;">Log in to complete your profile: <a href="https://intrafer.in/vendor/dashboard/profile" style="color:#B5541E;">Update Profile</a></p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
        <p style="font-size:12px;color:#aaa;">Intrafer — India's interior designer marketplace.</p>
      </div>
    `,
    availableVariables: ['name', 'businessName', 'rejectionReason'],
  },
  {
    key: 'password_reset',
    name: 'Password Reset Email',
    subject: 'Reset your Intrafer password',
    htmlBody: `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px;background:#fff;">
        <h2 style="color:#1A56B0;margin-bottom:8px;">Intrafer</h2>
        <p style="font-size:16px;color:#333;">Hi {{name}},</p>
        <p style="font-size:15px;color:#555;">We received a request to reset your Intrafer password. Click the button below to choose a new one:</p>
        <div style="text-align:center;margin:32px 0;">
          <a href="{{resetUrl}}" style="background:#1A56B0;color:#fff;text-decoration:none;padding:12px 28px;border-radius:6px;font-size:15px;font-weight:bold;">Reset Password</a>
        </div>
        <p style="font-size:13px;color:#888;">This link expires in <strong>30 minutes</strong>.</p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
        <p style="font-size:12px;color:#aaa;">If you didn't request this, you can safely ignore this email — your password will not be changed.</p>
      </div>
    `,
    availableVariables: ['name', 'resetUrl'],
  },
  {
    key: 'support_ticket_confirmation',
    name: 'Support Ticket Confirmation Email',
    subject: `We've received your message — Intrafer Support`,
    htmlBody: `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px;background:#fff;">
        <h2 style="color:#1A56B0;margin-bottom:8px;">Intrafer</h2>
        <p style="font-size:16px;color:#333;">Hi {{name}},</p>
        <p style="font-size:15px;color:#555;">Thanks for reaching out. We've received your message and our support team will get back to you within 24 hours.</p>
        <table style="width:100%;border-collapse:collapse;margin:24px 0;font-size:14px;">
          <tr style="background:#f5f8ff;">
            <td style="padding:10px 14px;font-weight:bold;color:#444;border:1px solid #e0e7ef;">Subject</td>
            <td style="padding:10px 14px;color:#333;border:1px solid #e0e7ef;">{{subject}}</td>
          </tr>
          <tr>
            <td style="padding:10px 14px;font-weight:bold;color:#444;border:1px solid #e0e7ef;vertical-align:top;">Message</td>
            <td style="padding:10px 14px;color:#333;border:1px solid #e0e7ef;">{{message}}</td>
          </tr>
        </table>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
        <p style="font-size:12px;color:#aaa;">If you have more details to add, just reply to this email.</p>
      </div>
    `,
    availableVariables: ['name', 'subject', 'message'],
  },
];

async function seed() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  let created = 0;
  let skipped = 0;

  for (const template of TEMPLATES) {
    const existing = await EmailTemplate.findOne({ key: template.key });
    if (existing) {
      skipped += 1;
      continue;
    }

    await EmailTemplate.create(template);
    created += 1;
  }

  console.log(`\nSeed complete — ${created} template(s) created, ${skipped} skipped (already existed).`);

  await mongoose.disconnect();
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
