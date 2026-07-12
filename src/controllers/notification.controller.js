const Notification = require('../models/Notification.model');
const catchAsync = require('../utils/catchAsync');
const { success, error } = require('../utils/apiResponse');
const paginate = require('../utils/paginate');

const getNotifications = catchAsync(async (req, res) => {
  const filter = { recipientId: req.user._id };
  const total = await Notification.countDocuments(filter);
  const { skip, limit, page, totalPages } = paginate(req.query, total);

  const notifications = await Notification.find(filter)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

  return success(res, { notifications, total, page, totalPages });
});

const getUnreadCount = catchAsync(async (req, res) => {
  const count = await Notification.countDocuments({ recipientId: req.user._id, isRead: false });
  return success(res, { count });
});

const markRead = catchAsync(async (req, res) => {
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.id, recipientId: req.user._id },
    { isRead: true },
    { new: true }
  );
  if (!notification) return error(res, 'Notification not found.', 404);
  return success(res, {}, 'Marked as read.');
});

const markAllRead = catchAsync(async (req, res) => {
  await Notification.updateMany({ recipientId: req.user._id, isRead: false }, { isRead: true });
  return success(res, {}, 'All notifications marked as read.');
});

module.exports = { getNotifications, getUnreadCount, markRead, markAllRead };
