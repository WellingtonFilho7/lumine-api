const fs = require('fs');

function loadGoogleCredentials({ raw = '', file = '' } = {}) {
  let credentials = {};

  try {
    if (file) {
      credentials = JSON.parse(fs.readFileSync(file, 'utf8'));
    } else {
      credentials = JSON.parse(raw);
    }
  } catch (_error) {
    throw new Error('Google credentials invalid JSON. Check GOOGLE_CREDENTIALS_FILE or GOOGLE_CREDENTIALS.');
  }

  if (!credentials.client_email || !credentials.private_key) {
    throw new Error('Google credentials must be Service Account JSON (missing client_email/private_key).');
  }

  return credentials;
}

module.exports = {
  loadGoogleCredentials,
};
