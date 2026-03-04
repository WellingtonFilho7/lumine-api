const { getSupabaseAdmin } = require('./supabase');

function createKnownError(code, message, statusCode = 500) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function asFirstRow(data) {
  if (Array.isArray(data)) return data[0] || null;
  return data || null;
}

function mapRpcError(scope, rpcError) {
  const message = String(rpcError?.message || 'Falha na operacao');
  const lower = message.toLowerCase();

  if (lower.includes('usuario nao encontrado')) {
    return createKnownError('USER_NOT_FOUND', 'Usuario nao encontrado', 404);
  }

  if (lower.includes('papel invalido')) {
    return createKnownError('VALIDATION_ERROR', 'Papel invalido', 400);
  }

  const error = createKnownError(
    'INTERNAL_USERS_RPC_ERROR',
    `Falha ao executar ${scope}`,
    503
  );
  error.publicMessage = 'Servico temporariamente indisponivel';
  return error;
}

async function listPendingInternalUsers() {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc('list_internal_pending_users');

  if (error) {
    throw mapRpcError('list_internal_pending_users', error);
  }

  const items = Array.isArray(data) ? data : [];
  return {
    items,
    total: items.length,
  };
}

async function approveInternalUserByEmail({ email, papel }) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc('approve_internal_user_by_email', {
    p_email: email,
    p_papel: papel,
  });

  if (error) {
    throw mapRpcError('approve_internal_user_by_email', error);
  }

  const row = asFirstRow(data);
  if (!row) {
    throw createKnownError('USER_NOT_FOUND', 'Usuario nao encontrado', 404);
  }

  return row;
}

module.exports = {
  __private: {
    mapRpcError,
    asFirstRow,
  },
  approveInternalUserByEmail,
  listPendingInternalUsers,
};
