const crypto = require('crypto');
const PendingEnquiryOtp = require('../models/PendingEnquiryOtp.model');
const Lead = require('../models/Lead.model');
const Vendor = require('../models/Vendor.model');
const Visitor = require('../models/Visitor.model');
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

// Proof-of-verification handed to the frontend once, right after a real OTP
// check succeeds here — cached alongside the contact details in
// localStorage (see lib/session.js's saveContact) and replayed on every
// later /enquiry/auto-submit call so that endpoint can create a Lead with
// no OTP step of its own while still not being a bare "trust the client"
// POST. Reuses JWT_ACCESS_SECRET rather than a dedicated env var — this
// isn't a session/auth token, just an HMAC binding a specific
// name+phone+email triple to "OTP-verified", so a second secret would add
// a config knob without adding real separation.
const makeContactToken = (email, phone, name) =>
  crypto.createHmac('sha256', process.env.JWT_ACCESS_SECRET).update(`${email}|${phone}|${name}`).digest('hex');

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
  const { pendingId, otp, vendorId, projectType, budget, city, requirements, isConsultation, preferredDate, sessionId } = req.body;

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

  const contactToken = makeContactToken(pending.email, pending.phone, pending.name);

  // vendorId present → this OTP verification is completing a specific
  // vendor's enquiry (Lead), same as before. Absent → it's the site-wide
  // "match me with designers" capture (LeadCapturePopup, with no vendor
  // picked yet) — same OTP gate, but nothing to attach a Lead to yet, so it
  // becomes a Visitor capture instead (see visitor.controller.js's
  // captureVisitor, whose upsert-by-sessionId shape this mirrors). Either
  // way the visitor leaves with the same contactToken, which is what lets
  // every later vendor page auto-send without asking for OTP again.
  if (vendorId) {
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

    // Only the vendor gets notified — there's no homeowner account left to
    // notify a guest enquirer through (see the homeowner-removal plan).
    notifService.dispatch('LEAD_ASSIGNED', { vendor, lead });

    return success(res, { lead, contactToken }, 'Enquiry submitted successfully.', 201);
  }

  const visitor = await Visitor.findOneAndUpdate(
    { sessionId: sessionId || `email:${pending.email}` },
    {
      $set: {
        name: pending.name,
        contact: pending.phone || pending.email,
        contactType: pending.phone ? 'phone' : 'email',
        city: city || '',
        isIdentified: true,
        source: 'popup',
      },
    },
    { upsert: true, new: true }
  );

  await PendingEnquiryOtp.deleteOne({ _id: pending._id });

  return success(res, { visitor, contactToken }, 'Enquiry submitted successfully.', 201);
});

// Background re-submission for a vendor the visitor hasn't engaged yet,
// using contact details an earlier OTP verification in this browser already
// vouched for (see makeContactToken above) — no OTP collected here, no form
// shown to the visitor. contactToken is the only thing standing between
// this and an arbitrary unverified Lead, so it's checked with a
// constant-time compare and never trusted on length/presence alone.
const autoSubmitEnquiry = catchAsync(async (req, res) => {
  const { name, phone, email, contactToken, vendorId, city } = req.body;

  const expected = makeContactToken(email, phone, name);
  const provided = String(contactToken || '');
  const valid = provided.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  if (!valid) return error(res, 'Contact not verified.', 401);

  const vendor = await Vendor.findOne({ _id: vendorId, isApproved: true, isListingEnabled: true });
  if (!vendor) return error(res, 'Vendor not available.', 404);

  // Defense in depth on top of the frontend's hasEngagedVendor localStorage
  // check — a retried request or a second tab should never double-create a
  // Lead for the same verified contact + vendor pair.
  const existing = await Lead.findOne({ vendorId: vendor._id, contactEmail: email, contactPhone: phone });
  if (existing) return success(res, { lead: existing }, 'Enquiry already sent.');

  const lead = await Lead.create({
    enquiryId: generateEnquiryId(),
    vendorId: vendor._id,
    contactName: name,
    contactEmail: email,
    contactPhone: phone,
    city: city || vendor.location?.city || '',
    requirements: '',
    statusHistory: [{ status: 'new' }],
  });

  await Vendor.findByIdAndUpdate(vendor._id, { $inc: { totalLeads: 1 } });
  notifService.dispatch('LEAD_ASSIGNED', { vendor, lead });

  return success(res, { lead }, 'Enquiry submitted successfully.', 201);
});

module.exports = { sendEnquiryOTP, submitGuestEnquiry, autoSubmitEnquiry };
