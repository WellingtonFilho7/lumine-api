const { createIntakeHandler } = require('../../lib/intake-endpoint');
const { matriculaSchema } = require('../../lib/intake-validation');
const { evolveToMatricula } = require('../../lib/intake-service');

module.exports = createIntakeHandler({
  action: 'matricula',
  schema: matriculaSchema,
  allowedRoles: ['admin', 'secretaria'],
  handler: evolveToMatricula,
  honeypot: false,
});
