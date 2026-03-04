const { z } = require('zod');

const APPROVABLE_ROLES = ['triagem', 'secretaria'];

const approveInternalUserSchema = z.object({
  email: z.string().trim().email('Email invalido'),
  papel: z.enum(APPROVABLE_ROLES).default('triagem'),
});

function parseAdminPayloadOrThrow(schema, payload) {
  const result = schema.safeParse(payload || {});
  if (result.success) return result.data;

  const firstIssue = result.error.issues[0];
  const error = new Error(firstIssue?.message || 'Payload invalido');
  error.statusCode = 400;
  error.code = 'VALIDATION_ERROR';
  error.meta = {
    path: firstIssue?.path || [],
    validation: 'zod',
  };
  throw error;
}

module.exports = {
  APPROVABLE_ROLES,
  approveInternalUserSchema,
  parseAdminPayloadOrThrow,
};
