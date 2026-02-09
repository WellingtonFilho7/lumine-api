const { z } = require('zod');
const { sanitizeOptional, sanitizeText } = require('./security');

const phoneRegex = /^[+()\d\s-]{8,20}$/;
const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/;

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

const preCadastroSchema = z.object({
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
  consentimentoLgpd: z.boolean(),
  consentimentoTexto: optionalText(400),
  telefoneAlternativo: optionalText(24),
  serie: optionalText(60),
});

const triagemSchema = z.object({
  preCadastroId: z.string().uuid(),
  resultado: z.enum(['em_triagem', 'aprovado', 'lista_espera', 'recusado']),
  healthCareNeeded: z.enum(['sim', 'nao']).optional(),
  healthNotes: optionalText(800),
  dietaryRestriction: z.enum(['sim', 'nao']).optional(),
  specialNeeds: optionalText(800),
  triageNotes: optionalText(1000),
  priority: z.enum(['alta', 'media', 'baixa']).optional(),
  priorityReason: optionalText(500),
});

const matriculaSchema = z
  .object({
    criancaId: z.string().uuid(),
    startDate: z.string().regex(isoDateRegex, 'startDate invalida'),
    participationDays: z.array(z.enum(['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom'])).min(1),
    authorizedPickup: requiredText('authorizedPickup', 300),
    canLeaveAlone: z.enum(['sim', 'nao']),
    leaveAloneConsent: z.boolean().optional(),
    leaveAloneConfirmation: optionalText(500),
    termsAccepted: z.boolean(),
    classGroup: optionalText(100),
    imageConsent: z.enum(['', 'interno', 'comunicacao']).optional(),
    documentsReceived: z.array(z.string()).optional(),
    initialObservations: optionalText(1200),
  })
  .superRefine((value, ctx) => {
    if (!value.termsAccepted) {
      ctx.addIssue({ code: 'custom', message: 'termsAccepted e obrigatorio', path: ['termsAccepted'] });
    }
    if (value.canLeaveAlone === 'sim') {
      if (!value.leaveAloneConsent) {
        ctx.addIssue({ code: 'custom', message: 'leaveAloneConsent e obrigatorio', path: ['leaveAloneConsent'] });
      }
      if (!value.leaveAloneConfirmation) {
        ctx.addIssue({ code: 'custom', message: 'leaveAloneConfirmation e obrigatorio', path: ['leaveAloneConfirmation'] });
      }
    }
  });

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
  matriculaSchema,
  parseOrThrow,
  preCadastroSchema,
  triagemSchema,
};
