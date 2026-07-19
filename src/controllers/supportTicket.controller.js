const SupportTicket = require('../models/SupportTicket.model');
const catchAsync = require('../utils/catchAsync');
const { success, error } = require('../utils/apiResponse');
const notifService = require('../services/notification.service');

const createTicket = catchAsync(async (req, res) => {
  const { name, email, phone, subject, message, userId } = req.body;
  if (!name || !email || !subject || !message) {
    return error(res, 'name, email, subject, and message are required.', 400);
  }

  const ticket = await SupportTicket.create({
    name,
    email,
    phone: phone || '',
    subject,
    message,
    userId: userId || null,
  });

  notifService.dispatch('SUPPORT_TICKET_CREATED', { ticket });

  return success(res, { ticket }, "Message sent. We'll get back to you within 24 hours.", 201);
});

const getAllTickets = catchAsync(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;

  const tickets = await SupportTicket.find(filter).sort({ createdAt: -1 });
  return success(res, { tickets });
});

const updateTicket = catchAsync(async (req, res) => {
  const { status, adminNotes } = req.body;

  const updates = {};
  if (status !== undefined) updates.status = status;
  if (adminNotes !== undefined) updates.adminNotes = adminNotes;

  const ticket = await SupportTicket.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });
  if (!ticket) return error(res, 'Ticket not found.', 404);

  return success(res, { ticket }, 'Ticket updated.');
});

module.exports = { createTicket, getAllTickets, updateTicket };
