const test = require('node:test');
const assert = require('node:assert/strict');

const service = require('../intake-service');

test('mapeia pre-cadastro para colunas novas e legado', () => {
  assert.equal(typeof service.__private?.buildPreCadastroInsert, 'function');

  const payload = {
    referralSource: 'indicacao',
    schoolCommuteAlone: 'nao',
    consentimentoLgpd: true,
    consentimentoTexto: 'termo legado',
    termoLgpdAssinado: true,
    termoLgpdData: '2026-02-13T12:00:00.000Z',
  };

  const row = service.__private.buildPreCadastroInsert(payload, {
    childId: 'child-1',
    fingerprint: 'abc',
    actorUserId: 'user-1',
  });

  assert.equal(row.consentimento_lgpd, true);
  assert.equal(row.termo_lgpd_assinado, true);
  assert.ok(row.termo_lgpd_data);
  assert.equal(row.consentimento_texto, 'termo legado');
});

test('mapeia triagem com campos novos sem perder fallback legado', () => {
  assert.equal(typeof service.__private?.buildTriagemUpsert, 'function');

  const row = service.__private.buildTriagemUpsert(
    {
      healthCareNeeded: 'nao',
      dietaryRestriction: 'sim',
      restricaoAlimentar: 'sem lactose',
      alergiaAlimentar: 'amendoim',
      alergiaMedicamento: 'dipirona',
      medicamentosEmUso: 'xarope',
      renovacao: true,
      resultado: 'aprovado',
      triageNotes: 'ok',
    },
    {
      childId: 'child-1',
      actorUserId: 'user-1',
      triageDate: '2026-02-13T12:00:00.000Z',
    }
  );

  assert.equal(row.dietary_restriction, 'sim');
  assert.equal(row.restricao_alimentar, 'sem lactose');
  assert.equal(row.alergia_alimentar, 'amendoim');
  assert.equal(row.renovacao, true);
});

test('mapeia matricula com novos termos legais e compatibilidade legado', () => {
  assert.equal(typeof service.__private?.buildMatriculaUpsert, 'function');

  const row = service.__private.buildMatriculaUpsert(
    {
      criancaId: 'child-1',
      startDate: '2026-02-13',
      participationDays: ['seg'],
      authorizedPickup: 'Mae',
      canLeaveAlone: 'sim',
      leaveAloneConsent: true,
      leaveAloneConfirmation: 'legado',
      leaveAloneConfirmado: true,
      consentimentoSaude: true,
      formaChegada: 'a_pe',
      termsAccepted: true,
      imageConsent: 'interno',
      documentsReceived: ['certidao_nascimento'],
      initialObservations: 'obs',
    },
    {
      actorUserId: 'user-1',
      nowIso: '2026-02-13T12:00:00.000Z',
    }
  );

  assert.equal(row.leave_alone_consent, true);
  assert.equal(row.leave_alone_confirmation, 'legado');
  assert.equal(row.leave_alone_confirmado, true);
  assert.equal(row.consentimento_saude, true);
  assert.equal(row.forma_chegada, 'a_pe');
});
