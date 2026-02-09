const { createIntakeHandler } = require('../../lib/intake-endpoint');
const { preCadastroSchema } = require('../../lib/intake-validation');
const { createPreCadastro } = require('../../lib/intake-service');

module.exports = createIntakeHandler({
  action: 'pre_cadastro',
  schema: preCadastroSchema,
  allowedRoles: [],
  handler: createPreCadastro,
  honeypot: true,
});
