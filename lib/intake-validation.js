const { z } = require('zod');
const { sanitizeOptional, sanitizeText } = require('./security');
const {
  coerceBoolean,
  normalizeClassGroup,
  normalizeDocuments,
  normalizeFormaChegada,
  normalizeImageConsent,
  normalizePriority,
  normalizeReferralSource,
  normalizeSchoolShift,
  normalizeYesNo,
} = require('./normalizers');

const phoneRegex = /^[+()\d\s-]{8,20}$/;
const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/;

const DOCUMENT_KEYS = [
  'certidao_nascimento',
  'documento_responsavel',
  'comprovante_residencia',
  'carteira_vacinacao',
];

const DOCUMENT_ENUM = z.enum(DOCUMENT_KEYS);

function isStrictModeEnabled() {
  return String(process.env.ENROLLMENT_STRICT_MODE || 'false').toLowerCase() === 'true';
}

function acceptsLegacyFields() {
  return String(process.env.ENROLLMENT_ACCEPT_LEGACY_FIELDS || 'true').toLowerCase() !== 'false';
}

const optionalText = max =>
  z
    .string()
    .transform(value => sanitizeOptional(value, max))
    .nullable()
    .optional();

const requiredText = (field, max = 200) =>
  z
    .string({ required_error: `${field} e obrigatorio` })
    .transform(value => sanitizeText(value, max))
    .refine(Boolean, `${field} e obrigatorio`);

const optionalBoolean = z.preprocess(coerceBoolean, z.boolean().optional());

function normalizePreCadastroPayload(raw) {
  const payload = raw && typeof raw === 'object' ? { ...raw } : {};
  payload.turnoEscolar = normalizeSchoolShift(payload.turnoEscolar);
  payload.referralSource = normalizeReferralSource(payload.referralSource);
  payload.schoolCommuteAlone = normalizeYesNo(payload.schoolCommuteAlone);

  const consentimentoLgpd = coerceBoolean(payload.consentimentoLgpd);
  if (consentimentoLgpd !== undefined) payload.consentimentoLgpd = consentimentoLgpd;

  const termoLgpdAssinado = coerceBoolean(payload.termoLgpdAssinado);
  if (termoLgpdAssinado !== undefined) payload.termoLgpdAssinado = termoLgpdAssinado;

  return payload;
}

function normalizeTriagemPayload(raw) {
  const payload = raw && typeof raw === 'object' ? { ...raw } : {};
  payload.healthCareNeeded = normalizeYesNo(payload.healthCareNeeded);
  payload.dietaryRestriction = normalizeYesNo(payload.dietaryRestriction);
  payload.priority = normalizePriority(payload.priority);

  const renovacao = coerceBoolean(payload.renovacao);
  if (renovacao !== undefined) payload.renovacao = renovacao;

  return payload;
}

function normalizeMatriculaPayload(raw) {
  const payload = raw && typeof raw === 'object' ? { ...raw } : {};
  payload.canLeaveAlone = normalizeYesNo(payload.canLeaveAlone);
  payload.imageConsent = normalizeImageConsent(payload.imageConsent);
  payload.documentsReceived = normalizeDocuments(payload.documentsReceived);
  payload.classGroup = normalizeClassGroup(payload.classGroup);
  const formaChegada = normalizeFormaChegada(payload.formaChegada);
  payload.formaChegada = formaChegada || undefined;

  const leaveAloneConsent = coerceBoolean(payload.leaveAloneConsent);
  if (leaveAloneConsent !== undefined) payload.leaveAloneConsent = leaveAloneConsent;

  const leaveAloneConfirmado = coerceBoolean(payload.leaveAloneConfirmado);
  if (leaveAloneConfirmado !== undefined) payload.leaveAloneConfirmado = leaveAloneConfirmado;

  const termsAccepted = coerceBoolean(payload.termsAccepted);
  if (termsAccepted !== undefined) payload.termsAccepted = termsAccepted;

  const consentimentoSaude = coerceBoolean(payload.consentimentoSaude);
  if (consentimentoSaude !== undefined) payload.consentimentoSaude = consentimentoSaude;

  return payload;
}

const preCadastroSchema = z.preprocess(
  normalizePreCadastroPayload,
  z
    .object({
      website: z.string().optional(),
      nomeCrianca: requiredText('nomeCrianca'),
      dataNascimento: z.string().regex(isoDateRegex, 'dataNascimento invalida'),
      nomeResponsavel: requiredText('nomeResponsavel'),
      telefonePrincipal: z
        .string({ required_error: 'telefonePrincipal e obrigatorio' })
        .transform(value => sanitizeText(value, 24))
        .refine(value => phoneRegex.test(value), 'telefonePrincipal invalido'),
      bairro: requiredText('bairro', 120),
      escola: requiredText('escola', 180),
      turnoEscolar: z.enum(['manha', 'tarde', 'integral']),
      referralSource: z.enum(['igreja', 'escola', 'CRAS', 'indicacao', 'redes_sociais', 'outro']),
      schoolCommuteAlone: z.enum(['sim', 'nao']),
      consentimentoLgpd: optionalBoolean,
      consentimentoTexto: optionalText(400),
      telefoneAlternativo: optionalText(24),
      serie: optionalText(60),

      sexo: z.enum(['M', 'F', 'nao_declarado']).optional(),
      parentesco: z.enum(['mae', 'pai', 'avo', 'tio', 'responsavel_legal', 'outro']).optional(),
      contatoEmergenciaNome: optionalText(200),
      contatoEmergenciaTelefone: z
        .string()
        .transform(value => sanitizeOptional(value, 24))
        .nullable()
        .optional()
        .refine(value => value == null || phoneRegex.test(value), 'contatoEmergenciaTelefone invalido'),
      termoLgpdAssinado: optionalBoolean,
      termoLgpdData: optionalText(64),
    })
    .superRefine((value, ctx) => {
      const strictMode = isStrictModeEnabled();

      const hasEmergencyName = Boolean(value.contatoEmergenciaNome);
      const hasEmergencyPhone = Boolean(value.contatoEmergenciaTelefone);
      if (hasEmergencyName !== hasEmergencyPhone) {
        ctx.addIssue({
          code: 'custom',
          message: 'Contato de emergencia precisa de nome e telefone',
          path: hasEmergencyName ? ['contatoEmergenciaTelefone'] : ['contatoEmergenciaNome'],
        });
      }

      if (strictMode && value.termoLgpdAssinado !== true) {
        ctx.addIssue({
          code: 'custom',
          message: 'termoLgpdAssinado e obrigatorio',
          path: ['termoLgpdAssinado'],
        });
      }

      if (!strictMode && !acceptsLegacyFields() && value.consentimentoLgpd !== undefined) {
        ctx.addIssue({
          code: 'custom',
          message: 'consentimentoLgpd legado nao aceito neste modo',
          path: ['consentimentoLgpd'],
        });
      }
    })
);

const triagemSchema = z.preprocess(
  normalizeTriagemPayload,
  z
    .object({
      preCadastroId: z.string().uuid(),
      resultado: z.enum(['em_triagem', 'aprovado', 'lista_espera', 'recusado']),
      healthCareNeeded: z.enum(['sim', 'nao']).optional(),
      healthNotes: optionalText(800),
      dietaryRestriction: z.enum(['sim', 'nao']).optional(),
      specialNeeds: optionalText(800),
      triageNotes: optionalText(1000),
      priority: z.enum(['alta', 'media', 'baixa']).optional(),
      priorityReason: optionalText(500),

      restricaoAlimentar: optionalText(400),
      alergiaAlimentar: optionalText(400),
      alergiaMedicamento: optionalText(400),
      medicamentosEmUso: optionalText(600),
      renovacao: optionalBoolean,
    })
    .superRefine((value, ctx) => {
      if (value.healthCareNeeded === 'sim' && !value.healthNotes) {
        ctx.addIssue({
          code: 'custom',
          message: 'healthNotes e obrigatorio quando healthCareNeeded=sim',
          path: ['healthNotes'],
        });
      }
    })
);

const matriculaSchema = z.preprocess(
  normalizeMatriculaPayload,
  z
    .object({
      criancaId: z.string().uuid(),
      startDate: z.string().regex(isoDateRegex, 'startDate invalida'),
      participationDays: z.array(z.enum(['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom'])).min(1),
      authorizedPickup: requiredText('authorizedPickup', 300),
      canLeaveAlone: z.enum(['sim', 'nao']),
      leaveAloneConsent: optionalBoolean,
      leaveAloneConfirmation: optionalText(500),
      leaveAloneConfirmado: optionalBoolean,
      termsAccepted: z.preprocess(coerceBoolean, z.boolean()),
      classGroup: optionalText(100),
      imageConsent: z.enum(['', 'interno', 'comunicacao']).optional(),
      documentsReceived: z.array(DOCUMENT_ENUM).optional(),
      initialObservations: optionalText(1200),
      consentimentoSaude: optionalBoolean,
      formaChegada: z.enum(['a_pe', 'transporte_escolar', 'levada_responsavel', 'outro']).optional(),
    })
    .superRefine((value, ctx) => {
      const strictMode = isStrictModeEnabled() || !acceptsLegacyFields();
      const allowLegacy = acceptsLegacyFields();

      if (!value.termsAccepted) {
        ctx.addIssue({ code: 'custom', message: 'termsAccepted e obrigatorio', path: ['termsAccepted'] });
      }

      if (value.canLeaveAlone === 'sim') {
        if (strictMode) {
          if (value.leaveAloneConfirmado !== true) {
            ctx.addIssue({
              code: 'custom',
              message: 'leaveAloneConfirmado e obrigatorio',
              path: ['leaveAloneConfirmado'],
            });
          }
        } else {
          const hasLegacy = value.leaveAloneConsent === true && Boolean(value.leaveAloneConfirmation);
          const hasNew = value.leaveAloneConfirmado === true;
          if (!hasLegacy && !hasNew) {
            ctx.addIssue({
              code: 'custom',
              message: 'Confirme autorizacao de saida desacompanhada',
              path: ['leaveAloneConsent'],
            });
          }
        }
      }

      if (strictMode) {
        if (value.consentimentoSaude !== true) {
          ctx.addIssue({
            code: 'custom',
            message: 'consentimentoSaude e obrigatorio',
            path: ['consentimentoSaude'],
          });
        }

        if (!value.formaChegada) {
          ctx.addIssue({
            code: 'custom',
            message: 'formaChegada e obrigatorio',
            path: ['formaChegada'],
          });
        }
      }

      if (!allowLegacy) {
        if (value.leaveAloneConsent !== undefined) {
          ctx.addIssue({
            code: 'custom',
            message: 'leaveAloneConsent legado nao aceito neste modo',
            path: ['leaveAloneConsent'],
          });
        }

        if (value.leaveAloneConfirmation) {
          ctx.addIssue({
            code: 'custom',
            message: 'leaveAloneConfirmation legado nao aceito neste modo',
            path: ['leaveAloneConfirmation'],
          });
        }
      }
    })
);

function parseOrThrow(schema, payload) {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    const message = firstIssue?.message || 'Payload invalido';
    const error = new Error(message);
    error.statusCode = 400;
    error.code = 'INVALID_PAYLOAD';
    throw error;
  }
  return parsed.data;
}

module.exports = {
  DOCUMENT_KEYS,
  matriculaSchema,
  parseOrThrow,
  preCadastroSchema,
  triagemSchema,
};
