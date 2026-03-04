const test = require('node:test');
const assert = require('node:assert/strict');

const {
  approveInternalUserSchema,
  parseAdminPayloadOrThrow,
} = require('../internal-users-validation');

test('approve schema aplica papel padrão triagem', () => {
  const parsed = parseAdminPayloadOrThrow(approveInternalUserSchema, {
    email: 'professora@lumine.org',
  });

  assert.equal(parsed.email, 'professora@lumine.org');
  assert.equal(parsed.papel, 'triagem');
});

test('approve schema rejeita papel admin', () => {
  assert.throws(() => {
    parseAdminPayloadOrThrow(approveInternalUserSchema, {
      email: 'professora@lumine.org',
      papel: 'admin',
    });
  }, /VALIDATION_ERROR|Invalid enum value|Payload invalido|papel/i);
});

test('approve schema rejeita email inválido', () => {
  assert.throws(() => {
    parseAdminPayloadOrThrow(approveInternalUserSchema, {
      email: 'sem-formato',
      papel: 'triagem',
    });
  }, /Email invalido|VALIDATION_ERROR|Payload invalido/i);
});
