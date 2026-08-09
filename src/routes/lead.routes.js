const express = require('express');
const { createLead, getVendorLeads, getLeadById, acceptLead, updateLeadStatus } = require('../controllers/lead.controller');
const { updateNotes } = require('../controllers/vendor.controller');
const { getMessages, sendMessage } = require('../controllers/message.controller');
const { protect } = require('../middleware/auth');
const rbac = require('../middleware/rbac');
const validate = require('../middleware/validate');
const { createLeadRules, updateStatusRules } = require('../validators/lead.validator');

const router = express.Router();

router.post('/',           protect, ...createLeadRules, validate, createLead);
router.get('/vendor',      protect, rbac('vendor'), getVendorLeads);
router.get('/:id',         protect, getLeadById);
router.put('/:id/accept',  protect, rbac('vendor'), acceptLead);
router.put('/:id/status',  protect, rbac('vendor'), ...updateStatusRules, validate, updateLeadStatus);
router.put('/:id/notes',   protect, rbac('vendor'), updateNotes);
router.get('/:id/messages',  protect, getMessages);
router.post('/:id/messages', protect, sendMessage);

module.exports = router;
