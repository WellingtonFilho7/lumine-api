const test = require('node:test');
const assert = require('node:assert/strict');

const syncService = require('../sync-supabase-service');

test('bloqueia regressao de status de matriculado para status de triagem no sync service', () => {
  assert.equal(typeof syncService.__private?.canTransitionEnrollmentStatus, 'function');

  assert.equal(syncService.__private.canTransitionEnrollmentStatus('matriculado', 'em_triagem'), false);
  assert.equal(syncService.__private.canTransitionEnrollmentStatus('matriculado', 'aprovado'), false);
  assert.equal(syncService.__private.canTransitionEnrollmentStatus('matriculado', 'lista_espera'), false);

  assert.equal(syncService.__private.canTransitionEnrollmentStatus('matriculado', 'desistente'), true);
  assert.equal(syncService.__private.canTransitionEnrollmentStatus('matriculado', 'inativo'), true);
  assert.equal(syncService.__private.canTransitionEnrollmentStatus('matriculado', 'matriculado'), true);
});
