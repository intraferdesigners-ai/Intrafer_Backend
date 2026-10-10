const jwt = require('jsonwebtoken');

// Short-lived signed token that lets an admin open a draft landing page at
// its real public URL (?preview=<token>). Signed with JWT_ACCESS_SECRET
// like login tokens, so the two are kept apart by claims: a preview token
// carries `purpose` and no `id`, and protect() (middleware/auth.js)
// rejects any token with a `purpose` or without an `id`. Verification here
// rejects anything whose purpose isn't exactly 'landing-preview' — a login
// token can't unlock a draft either.

const PREVIEW_PURPOSE = 'landing-preview';
const PREVIEW_TTL = '30m';

function signPreviewToken(pageId) {
  const token = jwt.sign({ purpose: PREVIEW_PURPOSE, lp: String(pageId) }, process.env.JWT_ACCESS_SECRET, {
    expiresIn: PREVIEW_TTL,
    algorithm: 'HS256',
  });
  return { token, expiresAt: new Date(jwt.decode(token).exp * 1000) };
}

// The token's page id, or null for anything invalid, expired, tampered
// with, or minted for another purpose. Never throws.
function verifyPreviewToken(token) {
  if (typeof token !== 'string' || !token) return null;
  try {
    const claims = jwt.verify(token, process.env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] });
    if (claims.purpose !== PREVIEW_PURPOSE || typeof claims.lp !== 'string' || claims.id !== undefined) return null;
    return claims.lp;
  } catch {
    return null;
  }
}

module.exports = { signPreviewToken, verifyPreviewToken, PREVIEW_PURPOSE };
