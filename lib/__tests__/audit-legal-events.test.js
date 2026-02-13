const test = require('node:test');
const assert = require('node:assert/strict');

const service = require('../intake-service');

const { buildLegalFlagsForAudit } = service.__private;

test('pre-cadastro legal flags registram apenas confirmacoes legais', () => {
  const flags = buildLegalFlagsForAudit(
    'pre_cadastro',
    {
      consentimentoLgpd: true,
      termoLgpdAssinado: true,
      termoLgpdData: '2026-02-13T12:00:00.000Z',
      consentimentoTexto: 'texto sensivel',
    },
    '2026-02-13T12:00:00.000Z'
  );

  assert.equal(flags.consentimento_lgpd, true);
  assert.equal(flags.termo_lgpd_assinado, true);
  assert.equal(flags.termo_lgpd_data, '2026-02-13T12:00:00.000Z');
  assert.equal(Object.prototype.hasOwnProperty.call(flags, 'consentimentoTexto'), false);
});

test('triagem legal flags nao incluem texto sensivel de saude', () => {
  const flags = buildLegalFlagsForAudit('triagem', {
    healthNotes: 'asma',
    specialNeeds: 'TEA',
    medicamentosEmUso: 'xarope',
    renovacao: true,
  });

  assert.deepEqual(flags, {
    health_data_informed: true,
    renovacao: true,
  });
  assert.equal(Object.prototype.hasOwnProperty.call(flags, 'healthNotes'), false);
});

test('matricula legal flags nao incluem texto livre legado', () => {
  const flags = buildLegalFlagsForAudit('matricula', {
    termsAccepted: true,
    leaveAloneConfirmado: true,
    consentimentoSaude: true,
    imageConsent: 'interno',
    leaveAloneConfirmation: 'texto livre legado',
  });

  assert.deepEqual(flags, {
    terms_accepted: true,
    leave_alone_confirmado: true,
    consentimento_saude: true,
    image_consent: 'interno',
  });
  assert.equal(Object.prototype.hasOwnProperty.call(flags, 'leaveAloneConfirmation'), false);
});
