const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const jwt = require('jsonwebtoken');

// Partitions the budget per logged-in user instead of per IP whenever a
// (well-formed, not necessarily still-valid — this is a rate-limit bucket
// key, not an auth decision) access token is present. Without this, every
// vendor/user behind the same NAT/office IP shares one 15-minute budget, and
// a single active dashboard tab's own background polling (NotificationBell,
// MessageThread) can starve everyone else on that IP out of their own
// unrelated requests, including their own uploads.
// Falls back to ipKeyGenerator() (not raw req.ip) so IPv6 addresses are
// still normalized by subnet the way express-rate-limit requires — using
// req.ip directly here would let an IPv6 client bypass the limit entirely
// by requesting from a fresh address within their own /64 on every request.
const keyByUserOrIP = (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    try {
      const decoded = jwt.decode(authHeader.slice(7));
      if (decoded?.id) return `user:${decoded.id}`;
    } catch {
      // fall through to IP
    }
  }
  return ipKeyGenerator(req, res);
};

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  // A single open MessageThread panel alone polls every 5s (see
  // components/shared/MessageThread.jsx), which is ~180 requests/15min on
  // its own — before counting NotificationBell's polling, normal dashboard
  // navigation, or an active multi-photo project upload session. The old
  // max: 100 was tuned as if this were a public/anonymous-traffic budget;
  // it wasn't accounting for what a single legitimately-active authenticated
  // tab generates, and vendors were hitting it (and its cross-endpoint 429)
  // during completely normal use.
  max: 400,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later.' },
  keyGenerator: keyByUserOrIP,
  // Silent token refresh fires once per expired access token regardless of
  // how many other requests an active user's session has made in the same
  // window — it shouldn't compete with that unrelated volume for the same
  // budget and risk a spurious logout via a 429 on refresh.
  skip: (req) => req.path === '/api/auth/refresh',
});

// Applies to the multi-photo project-image endpoints specifically (see
// vendor.routes.js), on top of (not instead of) globalLimiter — a dedicated,
// generous per-user ceiling so a burst of portfolio uploads can never be
// blocked by unrelated polling traffic eating the shared global budget, while
// still bounding upload volume independently of it.
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many uploads in a short time. Please wait a few minutes and try again.' },
  keyGenerator: keyByUserOrIP,
});

// Shared budget across both the login OTP endpoints (auth.routes.js) and the
// guest enquiry OTP endpoints (enquiry.routes.js) — /enquiry/submit is gated
// by this too (it's the OTP-verify step), so one full request+verify cycle
// already costs 2 of the budget. The old 5-per-10-min was tuned tight enough
// that ~2.5 full cycles tripped it, which was firing on ordinary repeated
// testing/use, not just abuse. Raised to a still-bounded but meaningfully
// more generous ceiling: brute-forcing a specific OTP code is independently
// capped by MAX_ATTEMPTS (3 wrong guesses locks that pendingId regardless of
// this limiter — see enquiry.controller.js), so this limiter's real job is
// bounding OTP-spam volume (cost/harassment via arbitrary phone/email), not
// code-guessing — 15 per 15 min per IP is still a hard cap on that while
// giving real use room to breathe.
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many OTP requests. Please wait before trying again.' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many login attempts, please try again later.' },
});

const newsletterLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many subscription attempts, please try again later.' },
});

module.exports = { globalLimiter, otpLimiter, authLimiter, newsletterLimiter, uploadLimiter };
