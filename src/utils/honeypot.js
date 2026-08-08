// Classic hidden-field honeypot for public, anonymous-facing forms
// (register, lead-capture/enquiry, contact, newsletter). The frontend
// renders a field named HONEYPOT_FIELD off-screen (see
// components/ui/Honeypot.jsx) — a real visitor never sees or fills it, but
// many bot scripts still populate every field they find, so any non-empty
// value here is a strong bot signal.
//
// isBot() is a plain check, not middleware, so each controller decides for
// itself what a "silent success" response looks like (matching its own
// real success shape) rather than one generic response faking every
// endpoint at once — the point is a bot's script sees a normal-looking 2xx
// and has no signal that anything was detected or that it should adapt.
const HONEYPOT_FIELD = 'website';

const isBot = (req) => !!(req.body && req.body[HONEYPOT_FIELD]);

module.exports = { HONEYPOT_FIELD, isBot };
