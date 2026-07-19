const multer = require('multer');
const path = require('path');
const fs = require('fs');

const USE_CLOUDINARY =
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET;

const USE_S3 =
  !USE_CLOUDINARY &&
  process.env.AWS_ACCESS_KEY_ID &&
  process.env.AWS_SECRET_ACCESS_KEY &&
  process.env.AWS_S3_BUCKET;

let storage;
let getFileUrl;

if (USE_CLOUDINARY) {
  const cloudinary = require('cloudinary').v2;
  const { CloudinaryStorage } = require('multer-storage-cloudinary');

  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });

  storage = new CloudinaryStorage({
    cloudinary,
    params: (req, file) => ({
      folder: req.uploadFolder || 'projects',
      allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
      transformation: [{ width: 2000, height: 2000, crop: 'limit' }],
    }),
  });

  getFileUrl = (file) => file.path;
} else if (USE_S3) {
  const multerS3 = require('multer-s3');
  const { S3Client } = require('@aws-sdk/client-s3');

  const s3 = new S3Client({
    region: process.env.AWS_REGION || 'ap-south-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });

  storage = multerS3({
    s3,
    bucket: process.env.AWS_S3_BUCKET,
    acl: 'public-read',
    contentType: multerS3.AUTO_CONTENT_TYPE,
    key: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const name = `projects/${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
      cb(null, name);
    },
  });

  getFileUrl = (file) => file.location;
} else {
  storage = multer.diskStorage({
    destination: (req, file, cb) => {
      const folder = req.uploadFolder || 'projects';
      const dest = path.join(process.cwd(), 'uploads', folder);
      fs.mkdirSync(dest, { recursive: true });
      cb(null, dest);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    },
  });

  getFileUrl = (file) => {
    const folder = file.destination ? path.basename(file.destination) : 'projects';
    const base = process.env.API_URL || 'http://localhost:5001';
    return `${base}/uploads/${folder}/${file.filename}`;
  };
}

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = /image\/(jpeg|png|webp)/.test(file.mimetype);
    if (ext && mime) return cb(null, true);
    cb(new Error('Only JPEG, PNG, WebP images allowed'));
  },
});

module.exports = { upload, getFileUrl };
