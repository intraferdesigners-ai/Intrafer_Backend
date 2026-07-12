const express = require('express');
const { protect } = require('../middleware/auth');
const { upload, getFileUrl } = require('../middleware/upload');
const { success, error } = require('../utils/apiResponse');

const router = express.Router();

router.post(
  '/avatar',
  protect,
  (req, res, next) => { req.uploadFolder = 'avatars'; next(); },
  upload.single('avatar'),
  (req, res) => {
    if (!req.file) return error(res, 'No file uploaded.', 400);
    const url = getFileUrl(req.file);
    return success(res, { url }, 'Uploaded successfully.');
  }
);

module.exports = router;
