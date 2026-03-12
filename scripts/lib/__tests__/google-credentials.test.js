const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { loadGoogleCredentials } = require('../google-credentials');

test('loadGoogleCredentials aceita JSON bruto em env', () => {
  const creds = loadGoogleCredentials({
    raw: JSON.stringify({
      type: 'service_account',
      client_email: 'bot@example.com',
      private_key: 'key',
    }),
    file: '',
  });

  assert.equal(creds.client_email, 'bot@example.com');
});

test('loadGoogleCredentials aceita arquivo JSON', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumine-google-creds-'));
  const file = path.join(dir, 'service-account.json');
  fs.writeFileSync(
    file,
    JSON.stringify({
      type: 'service_account',
      client_email: 'file@example.com',
      private_key: 'key',
    }),
    'utf8'
  );

  const creds = loadGoogleCredentials({
    raw: '',
    file,
  });

  assert.equal(creds.client_email, 'file@example.com');
});

test('loadGoogleCredentials rejeita JSON sem campos de service account', () => {
  assert.throws(
    () =>
      loadGoogleCredentials({
        raw: JSON.stringify({ installed: { client_id: 'abc' } }),
        file: '',
      }),
    /Service Account JSON/
  );
});
