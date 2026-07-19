// Replaces every {{key}} occurrence in `str` with variables[key] (empty
// string if the key is missing), used for both email subject and htmlBody.
function renderTemplate(str, variables = {}) {
  return str.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => {
    const value = variables[key];
    return value === undefined || value === null ? '' : String(value);
  });
}

module.exports = renderTemplate;
