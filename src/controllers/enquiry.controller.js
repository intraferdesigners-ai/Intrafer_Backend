const crypto = require('crypto');
const PendingEnquiryOtp = require('../models/PendingEnquiryOtp.model');
const Lead = require('../models/Lead.model');
const Vendor = require('../models/Vendor.model');
const catchAsync = require('../utils/catchAsync');
const { success, error } = require('../utils/apiResponse');
const generateEnquiryId = require('../utils/generateEnquiryId');
const emailService = require('../services/email.service');
const notifService = require('../services/notification.service');
const { isBot } = require('../utils/honeypot');

// Guest-enquiry OTP path — kept entirely separate from otp.service.js (which
// is keyed by User._id) so a "Submit enquiry" visitor never gets a User row
// created or a session issued just for answering a spam check. Same
// shape/expiry/attempts semantics as otp.service.js, just persisted on
// PendingEnquiryOtp instead of User.otp.
const OTP_EXPIRY_MINUTES = 10;
const MAX_ATTEMPTS = 3;

const generateOTP = () => crypto.randomInt(100000, 999999).toString();

// Same-shaped fake id as auth.controller.js's honeypot responses — looks like
// a real Mongo ObjectId without anything having actually been created.
const fakeObjectId = () => crypto.randomBytes(12).toString('hex');

const sendEnquiryOTP = catchAsync(async (req, res) => {
  const { name, email, phone } = req.body;

  // Honeypot tripped — fake success, no PendingEnquiryOtp row created and no
  // email sent. Same silent-success shape as auth.controller.js's sendOTP so
  // a bot's script has no signal anything was detected. See
  // src/utils/honeypot.js.
  if (isBot(req)) {
    return success(res, { pendingId: fakeObjectId() }, 'OTP sent to your email.');
  }

  const code = generateOTP();
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

  // Upserted by email, not created fresh each time — the enquiry/verify page
  // holds this doc's _id in a URL param for the lifetime of the OTP step, so
  // a "Resend code" call must return the SAME id (with a reset code/expiry/
  // attempts) rather than a new one the page has no way to pick up. Same
  // effective behaviour as otp.service.js's User-based createAndSaveOTP,
  // which likewise overwrites the existing otp subdocument in place.
  const pending = await PendingEnquiryOtp.findOneAndUpdate(
    { email },
    { name, email, phone, code, expiresAt, attempts: 0 },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  emailService.sendOTPEmail({ to: email, name, otp: code }).catch((err) =>
    console.error('[EnquiryOTP] Email send failed:', err.message)
  );

  return success(res, { pendingId: pending._id }, 'OTP sent to your email.');
});

const submitGuestEnquiry = catchAsync(async (req, res) => {
  const { pendingId, otp, vendorId, projectType, budget, city, requirements, isConsultation, preferredDate } = req.body;

  // Honeypot tripped — fake success, no Lead created. A bot that reaches
  // this endpoint at all would need a pendingId it never legitimately
  // received (see sendEnquiryOTP above), so this is defense in depth rather
  // than the primary gate — but it keeps the response shape consistent for
  // any bot script that does carry a `website` field through both requests.
  if (isBot(req)) {
    return success(res, { lead: { _id: fakeObjectId(), enquiryId: generateEnquiryId() } }, 'Enquiry submitted successfully.', 201);
  }

  const pending = await PendingEnquiryOtp.findById(pendingId);
  if (!pending) return error(res, 'OTP not found. Please request a new one.', 400);

  if (pending.attempts >= MAX_ATTEMPTS) {
    return error(res, 'Too many incorrect attempts. Please request a new OTP.', 400);
  }
  if (Date.now() > pending.expiresAt.getTime()) {
    return error(res, 'OTP has expired. Please request a new one.', 400);
  }
  if (otp !== pending.code) {
    pending.attempts += 1;
    await pending.save();
    return error(res, 'Incorrect OTP.', 400);
  }

  const vendor = await Vendor.findOne({ _id: vendorId, isApproved: true, isListingEnabled: true });
  if (!vendor) return error(res, 'Vendor not available.', 404);

  const lead = await Lead.create({
    enquiryId: generateEnquiryId(),
    vendorId: vendor._id,
    contactName: pending.name,
    contactEmail: pending.email,
    contactPhone: pending.phone,
    projectType,
    budget,
    city,
    requirements,
    isConsultation: !!isConsultation,
    preferredDate: preferredDate || '',
    statusHistory: [{ status: 'new' }],
  });

  await Vendor.findByIdAndUpdate(vendor._id, { $inc: { totalLeads: 1 } });
  await PendingEnquiryOtp.deleteOne({ _id: pending._id });

  // No ENQUIRY_CREATED dispatch here — that notification targets a
  // homeowner's in-app notification center (Notification.recipientId is a
  // required User ref), and a guest enquiry has no User to notify. Vendor
  // still gets notified below exactly as before.
  notifService.dispatch('LEAD_ASSIGNED', { vendor, lead });

  return success(res, { lead }, 'Enquiry submitted successfully.', 201);
});

module.exports = { sendEnquiryOTP, submitGuestEnquiry };
