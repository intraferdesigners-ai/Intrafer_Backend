// Safe handling of user-supplied query values that end up in Mongo filters.

const MAX_QUERY_LENGTH = 100;

// Escapes every RegExp metacharacter, so the string matches literally.
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A query-string value as a trimmed string capped at `max` chars, or
// undefined when it is missing, empty or not a string — arrays and objects
// (?city[]=a, ?city[$ne]=x) are ignored rather than reaching Mongo as
// values or operators.
function queryString(value, max = MAX_QUERY_LENGTH) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().slice(0, max);
  return trimmed || undefined;
}

// Case-insensitive literal "contains" match for a user-supplied value, or
// undefined when queryString() rejects it.
function containsRegex(value) {
  const str = queryString(value);
  return str === undefined ? undefined : new RegExp(escapeRegex(str), 'i');
}

module.exports = { MAX_QUERY_LENGTH, escapeRegex, queryString, containsRegex };
