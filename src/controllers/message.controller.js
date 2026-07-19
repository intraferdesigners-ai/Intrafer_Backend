const Lead = require('../models/Lead.model');
const Vendor = require('../models/Vendor.model');
const Message = require('../models/Message.model');
const catchAsync = require('../utils/catchAsync');
const { success, error } = require('../utils/apiResponse');
const notifService = require('../services/notification.service');
const { CONTACT_REVEALED_STATUSES } = require('./lead.controller');

// Resolves whether req.user is a participant on this lead (the enquirer, or
// the vendor it was assigned to) and, for vendors, hands back their Vendor doc
// so callers don't have to look it up again.
const resolveParticipant = async (lead, user) => {
  if (user.role === 'user') {
    return lead.userId.equals(user._id) ? { role: 'user' } : null;
  }
  if (user.role === 'vendor') {
    const vendor = await Vendor.findOne({ userId: user._id });
    if (!vendor || !lead.vendorId.equals(vendor._id)) return null;
    return { role: 'vendor', vendor };
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

  const vendor = participant.vendor || await Vendor.findById(lead.vendorId);
  const recipientId = req.user.role === 'user' ? vendor.userId : lead.userId;
  const recipientRole = req.user.role === 'user' ? 'vendor' : 'user';

  notifService.dispatch('NEW_MESSAGE', {
    recipientId, recipientRole, senderName: req.user.name, lead,
  });

  return success(res, { message }, 'Message sent.', 201);
});

module.exports = { getMessages, sendMessage };
