const test = require('node:test');
const assert = require('node:assert/strict');

function loadValidation() {
  const modulePath = require.resolve('../intake-validation');
  delete require.cache[modulePath];
  return require('../intake-validation');
}

const VALID_UUID = '11111111-1111-4111-8111-111111111111';

function baseMatriculaPayload() {
  return {
    criancaId: VALID_UUID,
    startDate: '2026-02-13',
    participationDays: ['seg', 'qua'],
    authorizedPickup: 'Mae e avo',
    canLeaveAlone: 'nao',
    termsAccepted: true,
    documentsReceived: ['certidao_nascimento'],
  };
}

test('normaliza turno escolar e referral source acentuados para valores canonicos ASCII', () => {
  process.env.ENROLLMENT_STRICT_MODE = 'false';
  process.env.ENROLLMENT_ACCEPT_LEGACY_FIELDS = 'true';

  const { parseOrThrow, preCadastroSchema } = loadValidation();
  const parsed = parseOrThrow(preCadastroSchema, {
    website: '',
    nomeCrianca: 'Teste Criança',
    dataNascimento: '2017-05-10',
    nomeResponsavel: 'Responsável',
    telefonePrincipal: '83999991111',
    bairro: 'Centro',
    escola: 'Escola A',
    turnoEscolar: 'manhã',
    referralSource: 'indicação',
    schoolCommuteAlone: 'não',
    consentimentoLgpd: true,
  });

  assert.equal(parsed.turnoEscolar, 'manha');
  assert.equal(parsed.referralSource, 'indicacao');
  assert.equal(parsed.schoolCommuteAlone, 'nao');
});

test('rejeita documentsReceived fora do conjunto permitido', () => {
  process.env.ENROLLMENT_STRICT_MODE = 'false';
  process.env.ENROLLMENT_ACCEPT_LEGACY_FIELDS = 'true';

  const { parseOrThrow, matriculaSchema } = loadValidation();
  assert.throws(() => {
    parseOrThrow(matriculaSchema, {
      ...baseMatriculaPayload(),
      documentsReceived: ['documento_invalido'],
    });
  }, /documentsReceived|Payload invalido|Invalid/);
});

test('aceita payload legado de matricula em modo de compatibilidade', () => {
  process.env.ENROLLMENT_STRICT_MODE = 'false';
  process.env.ENROLLMENT_ACCEPT_LEGACY_FIELDS = 'true';

  const { parseOrThrow, matriculaSchema } = loadValidation();
  const parsed = parseOrThrow(matriculaSchema, {
    ...baseMatriculaPayload(),
    canLeaveAlone: 'sim',
    leaveAloneConsent: true,
    leaveAloneConfirmation: 'Responsavel autoriza saida desacompanhada',
  });

  assert.equal(parsed.canLeaveAlone, 'sim');
  assert.equal(parsed.leaveAloneConsent, true);
});

test('aceita payload novo de matricula com campos LGPD especificos', () => {
  process.env.ENROLLMENT_STRICT_MODE = 'true';
  process.env.ENROLLMENT_ACCEPT_LEGACY_FIELDS = 'true';

  const { parseOrThrow, matriculaSchema } = loadValidation();
  const parsed = parseOrThrow(matriculaSchema, {
    ...baseMatriculaPayload(),
    canLeaveAlone: 'sim',
    leaveAloneConfirmado: true,
    consentimentoSaude: true,
    formaChegada: 'levada_responsavel',
    documentsReceived: ['certidao_nascimento', 'carteira_vacinacao'],
  });

  assert.equal(parsed.leaveAloneConfirmado, true);
  assert.equal(parsed.consentimentoSaude, true);
  assert.equal(parsed.formaChegada, 'levada_responsavel');
});

test('triagem aceita campos novos sem dietaryRestriction legado', () => {
  process.env.ENROLLMENT_STRICT_MODE = 'false';
  process.env.ENROLLMENT_ACCEPT_LEGACY_FIELDS = 'true';

  const { parseOrThrow, triagemSchema } = loadValidation();
  const parsed = parseOrThrow(triagemSchema, {
    preCadastroId: VALID_UUID,
    resultado: 'aprovado',
    healthCareNeeded: 'sim',
    healthNotes: 'Asma leve',
    restricaoAlimentar: 'Sem lactose',
    alergiaAlimentar: 'Amendoim',
    alergiaMedicamento: 'Dipirona',
    medicamentosEmUso: 'Inalador SOS',
    renovacao: false,
    priority: 'media',
    triageNotes: 'Triagem concluida',
  });

  assert.equal(parsed.resultado, 'aprovado');
  assert.equal(parsed.priority, 'media');
  assert.equal(parsed.dietaryRestriction, undefined);
});

test('modo estrito exige confirmacoes legais novas', () => {
  process.env.ENROLLMENT_STRICT_MODE = 'true';
  process.env.ENROLLMENT_ACCEPT_LEGACY_FIELDS = 'true';

  const { parseOrThrow, matriculaSchema } = loadValidation();

  assert.throws(() => {
    parseOrThrow(matriculaSchema, {
      ...baseMatriculaPayload(),
      canLeaveAlone: 'sim',
      leaveAloneConsent: true,
      leaveAloneConfirmation: 'texto legado',
    });
  }, /consentimentoSaude|formaChegada|leaveAloneConfirmado|obrigatorio|obrigatoria/i);
});

test('modo estrito exige termo LGPD assinado no pre-cadastro', () => {
  process.env.ENROLLMENT_STRICT_MODE = 'true';
  process.env.ENROLLMENT_ACCEPT_LEGACY_FIELDS = 'true';

  const { parseOrThrow, preCadastroSchema } = loadValidation();

  assert.throws(() => {
    parseOrThrow(preCadastroSchema, {
      website: '',
      nomeCrianca: 'Teste',
      dataNascimento: '2017-05-10',
      nomeResponsavel: 'Responsavel',
      telefonePrincipal: '83999991111',
      bairro: 'Centro',
      escola: 'Escola A',
      turnoEscolar: 'manha',
      referralSource: 'igreja',
      schoolCommuteAlone: 'nao',
      consentimentoLgpd: true,
    });
  }, /termoLgpdAssinado|obrigatorio|obrigatoria/i);
});
