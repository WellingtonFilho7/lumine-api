const { createIntakeHandler } = require('../../lib/intake-endpoint');
const { triagemSchema } = require('../../lib/intake-validation');
const { evolveToTriagem } = require('../../lib/intake-service');

module.exports = createIntakeHandler({
  action: 'triagem',
  schema: triagemSchema,
  allowedRoles: ['admin', 'triagem'],
  handler: evolveToTriagem,
  honeypot: false,
});
