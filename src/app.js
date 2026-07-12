const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const { globalLimiter } = require('./middleware/rateLimiter');
const errorHandler = require('./middleware/errorHandler');

const authRoutes         = require('./routes/auth.routes');
const publicRoutes       = require('./routes/public.routes');
const leadRoutes         = require('./routes/lead.routes');
const vendorRoutes       = require('./routes/vendor.routes');
const subscriptionRoutes = require('./routes/subscription.routes');
const notificationRoutes = require('./routes/notification.routes');
const uploadRoutes       = require('./routes/upload.routes');
const adminRoutes        = require('./routes/admin.routes');
const reviewRoutes       = require('./routes/review.routes');
const visitorRoutes      = require('./routes/visitor.routes');

const app = express();

const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'https://intrafer.in',
  'https://www.intrafer.in',
  process.env.CLIENT_URL,
].filter(Boolean);

app.use(helmet());
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(globalLimiter);
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(cookieParser());
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    version: '1.0.0',
  });
});

app.get('/', (req, res) => {
  res.json({ message: 'Intrafer API v1.0.0' });
});

app.use('/api/auth',          authRoutes);
app.use('/api/public',        publicRoutes);
app.use('/api/leads',         leadRoutes);
app.use('/api/vendor',        vendorRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/upload',        uploadRoutes);
app.use('/api/admin',         adminRoutes);
app.use('/api/reviews',       reviewRoutes);
app.use('/api/visitor',       visitorRoutes);

app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.method} ${req.originalUrl} not found` });
});

app.use(errorHandler);

module.exports = app;
