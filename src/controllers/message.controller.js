const Lead = require('../models/Lead.model');
const Vendor = require('../models/Vendor.model');
const User = require('../models/User.model');
const Message = require('../models/Message.model');
const catchAsync = require('../utils/catchAsync');
const { success, error } = require('../utils/apiResponse');
const notifService = require('../services/notification.service');
const { CONTACT_REVEALED_STATUSES } = require('./lead.controller');

// Resolves whether req.user is a participant on this lead. Vendor/admin
// only — a message thread is now a vendor+admin status-note thread with no
// homeowner-side reply capability at all (guest enquirers have no login to
// reply from in the first place; see enquiry.controller.js). See the
// homeowner-removal plan, Phase 0/7. Pre-removal threads that do have a real
// homeowner sender (senderRole: 'user') are unaffected — they still load via
// getMessages below, just as read-only history now that 'user' can no
// longer authenticate its way back into resolveParticipant.
const resolveParticipant = async (lead, user) => {
  if (user.role === 'vendor') {
    const vendor = await Vendor.findOne({ userId: user._id });
    if (!vendor || !lead.vendorId.equals(vendor._id)) return null;
    return { role: 'vendor', vendor };
  }
  if (user.role === 'admin') {
    return { role: 'admin' };
  }
  return null;
};

const getMessages = catchAsync(async (req, res) => {
  const lead = await Lead.findById(req.params.id);
  if (!lead) return error(res, 'Lead not found.', 404);

  const participant = await resolveParticipant(lead, req.user);
  if (!participant) return error(res, 'Not authorised.', 403);

  if (!CONTACT_REVEALED_STATUSES.includes(lead.status)) {
    return error(res, 'Messaging unlocks once contact details are revealed for this lead.', 403);
  }

  const messages = await Message.find({ leadId: lead._id }).sort({ createdAt: 1 });

  const unread = messages.filter((m) => !m.senderId.equals(req.user._id) && !m.readAt);
  if (unread.length > 0) {
    const now = new Date();
    await Message.updateMany({ _id: { $in: unread.map((m) => m._id) } }, { readAt: now });
    unread.forEach((m) => { m.readAt = now; });
  }

  return success(res, { messages });
});

const sendMessage = catchAsync(async (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) return error(res, 'Message text is required.', 400);

  const lead = await Lead.findById(req.params.id);
  if (!lead) return error(res, 'Lead not found.', 404);

  const participant = await resolveParticipant(lead, req.user);
  if (!participant) return error(res, 'Not authorised.', 403);

  if (!CONTACT_REVEALED_STATUSES.includes(lead.status)) {
    return error(res, 'Messaging unlocks once contact details are revealed for this lead.', 403);
  }

  const message = await Message.create({
    leadId: lead._id,
    senderId: req.user._id,
    senderRole: req.user.role,
    text: text.trim(),
  });

  // A vendor note is fanned out to every admin (same "notify all admins"
  // pattern notification.service.js's SUPPORT_TICKET_CREATED already uses —
  // there's no per-lead admin assignment to narrow this to). An admin note
  // goes to the one vendor the lead is assigned to, same as before.
  if (req.user.role === 'vendor') {
    const admins = await User.find({ role: 'admin' }).select('_id');
    admins.forEach((admin) => notifService.dispatch('NEW_MESSAGE', {
      recipientId: admin._id, recipientRole: 'admin', senderName: req.user.name, lead,
    }));
  } else {
    const vendor = participant.vendor || await Vendor.findById(lead.vendorId);
    notifService.dispatch('NEW_MESSAGE', {
      recipientId: vendor.userId, recipientRole: 'vendor', senderName: req.user.name, lead,
    });
  }

  return success(res, { message }, 'Message sent.', 201);
});

module.exports = { getMessages, sendMessage };
