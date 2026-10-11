// A 24-hex ObjectId string. Request ids that fail this never reach a query,
// where Mongoose would throw a cast error (a 500) instead of "not found".
const OBJECT_ID = /^[a-f0-9]{24}$/i;
const isObjectId = (value) => typeof value === 'string' && OBJECT_ID.test(value);

module.exports = { isObjectId };
