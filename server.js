require('dotenv').config();

const http = require('http');
const connectDB = require('./src/config/db');
const app = require('./src/app');
const { startJobs } = require('./src/jobs/subscriptionExpiry.job');

const PORT = process.env.PORT || 5000;

const start = async () => {
  await connectDB();

  const server = http.createServer(app);

  server.listen(PORT, () => {
    console.log(`[SERVER] Intrafer API running on port ${PORT} in ${process.env.NODE_ENV} mode`);
    console.log(`[SERVER] Health check: http://localhost:${PORT}/health`);
    startJobs();
  });

  process.on('unhandledRejection', (err) => {
    console.error(err);
    server.close(() => process.exit(1));
  });
};

start();
