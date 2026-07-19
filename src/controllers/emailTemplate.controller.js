const EmailTemplate = require('../models/EmailTemplate.model');
const catchAsync = require('../utils/catchAsync');
const { success, error } = require('../utils/apiResponse');

const getAllTemplates = catchAsync(async (req, res) => {
  const templates = await EmailTemplate.find().sort({ name: 1 });
  return success(res, { templates });
});

// key and name are intentionally not editable — code looks templates up by
// key directly, so only the sendable content (subject/htmlBody) and isActive
// are mutable here.
const updateTemplate = catchAsync(async (req, res) => {
  const { subject, htmlBody, isActive } = req.body;

  const updates = {};
  if (subject !== undefined) updates.subject = subject;
  if (htmlBody !== undefined) updates.htmlBody = htmlBody;
  if (isActive !== undefined) updates.isActive = isActive;

  const template = await EmailTemplate.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });
  if (!template) return error(res, 'Template not found.', 404);

  return success(res, { template }, 'Template updated.');
});

module.exports = { getAllTemplates, updateTemplate };
