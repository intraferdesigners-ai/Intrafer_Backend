const transporter = require('../config/mailer');

const sendOTPEmail = async ({ to, name, otp }) => {
  const from = `"${process.env.FROM_NAME}" <${process.env.FROM_EMAIL}>`;
  await transporter.sendMail({
    from,
    to,
    subject: 'Your Intrafer Verification Code',
    html: `
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
    `,
  });
};

const sendLeadAssignedEmail = async ({ to, vendorName, enquiryId, projectType, city, budget }) => {
  const from = `"${process.env.FROM_NAME}" <${process.env.FROM_EMAIL}>`;
  const dashboardUrl = `${process.env.CLIENT_URL}/vendor/dashboard/leads`;
  await transporter.sendMail({
    from,
    to,
    subject: `New Lead Assigned — ${enquiryId}`,
    html: `
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
    `,
  });
};

const sendSubscriptionConfirmEmail = async ({ to, vendorName, planName, endDate }) => {
  const from = `"${process.env.FROM_NAME}" <${process.env.FROM_EMAIL}>`;
  const formattedDate = new Date(endDate).toLocaleDateString('en-IN');
  await transporter.sendMail({
    from,
    to,
    subject: 'Subscription Activated — Intrafer',
    html: `
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
    `,
  });
};

const sendVendorApprovedEmail = async ({ to, name, businessName }) => {
  const from = `"${process.env.FROM_NAME}" <${process.env.FROM_EMAIL}>`;
  await transporter.sendMail({
    from,
    to,
    subject: 'Your Intrafer listing is approved! 🎉',
    html: `
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
    `,
  });
};

const sendVendorRejectedEmail = async ({ to, name, businessName, rejectionReason }) => {
  const from = `"${process.env.FROM_NAME}" <${process.env.FROM_EMAIL}>`;
  await transporter.sendMail({
    from,
    to,
    subject: 'Update on your Intrafer application',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px;background:#fff;">
        <h2 style="color:#B5541E;margin-bottom:8px;">Intrafer</h2>
        <h3 style="color:#222;">Application update required</h3>
        <p style="font-size:15px;color:#333;">Hi ${name},</p>
        <p style="font-size:15px;color:#555;">Thank you for applying to list <strong>${businessName}</strong> on Intrafer.</p>
        <p style="font-size:15px;color:#555;">We need a few more details before we can approve your listing:</p>
        <blockquote style="border-left:3px solid #B5541E;padding-left:12px;color:#555;margin:16px 0;">
          ${rejectionReason || 'Please complete your profile and add portfolio photos.'}
        </blockquote>
        <p style="font-size:15px;color:#555;">Log in to complete your profile: <a href="https://intrafer.in/vendor/dashboard/profile" style="color:#B5541E;">Update Profile</a></p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
        <p style="font-size:12px;color:#aaa;">Intrafer — India's interior designer marketplace.</p>
      </div>
    `,
  });
};

module.exports = { sendOTPEmail, sendLeadAssignedEmail, sendSubscriptionConfirmEmail, sendVendorApprovedEmail, sendVendorRejectedEmail };
