const express = require('express');
const { createLead, getUserLeads, getVendorLeads, getLeadById, acceptLead, confirmAppointment, updateLeadStatus, cancelLead } = require('../controllers/lead.controller');
const { updateNotes } = require('../controllers/vendor.controller');
const { getMessages, sendMessage } = require('../controllers/message.controller');
const { protect } = require('../middleware/auth');
const rbac = require('../middleware/rbac');
const validate = require('../middleware/validate');
const { createLeadRules, updateStatusRules } = require('../validators/lead.validator');

const router = express.Router();

router.post('/',           protect, ...createLeadRules, validate, createLead);
router.get('/user',        protect, rbac('user'), getUserLeads);
router.get('/vendor',      protect, rbac('vendor'), getVendorLeads);
router.get('/:id',         protect, getLeadById);
router.put('/:id/accept',  protect, rbac('vendor'), acceptLead);
router.put('/:id/confirm-appointment', protect, rbac('vendor'), confirmAppointment);
router.put('/:id/status',  protect, rbac('vendor'), ...updateStatusRules, validate, updateLeadStatus);
router.put('/:id/notes',   protect, rbac('vendor'), updateNotes);
router.put('/:id/cancel',  protect, rbac('user'), cancelLead);
router.get('/:id/messages',  protect, getMessages);
router.post('/:id/messages', protect, sendMessage);

module.exports = router;
