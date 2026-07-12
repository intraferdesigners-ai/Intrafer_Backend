const express = require('express');
const { getNotifications, getUnreadCount, markRead, markAllRead } = require('../controllers/notification.controller');
const { protect } = require('../middleware/auth');

const router = express.Router();

router.get('/',            protect, getNotifications);
router.get('/unread-count', protect, getUnreadCount);
router.put('/read-all',    protect, markAllRead);
router.put('/:id/read',    protect, markRead);

module.exports = router;
