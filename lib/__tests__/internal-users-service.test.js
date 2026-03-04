const test = require('node:test');
const assert = require('node:assert/strict');

function loadServiceWithRpc(rpcImpl) {
  const servicePath = require.resolve('../internal-users-service');
  const supabasePath = require.resolve('../supabase');

  delete require.cache[servicePath];
  delete require.cache[supabasePath];

  require.cache[supabasePath] = {
    id: supabasePath,
    filename: supabasePath,
    loaded: true,
    exports: {
      getSupabaseAdmin: () => ({
        rpc: rpcImpl,
      }),
    },
  };

  const service = require('../internal-users-service');

  delete require.cache[servicePath];
  delete require.cache[supabasePath];

  return service;
}

test('listPendingInternalUsers retorna items e total', async () => {
  const service = loadServiceWithRpc(async fn => {
    assert.equal(fn, 'list_internal_pending_users');
    return {
      data: [{ id: 'u1', email: 'p1@x.com', ativo: false }],
      error: null,
    };
  });

  const result = await service.listPendingInternalUsers();
  assert.equal(result.total, 1);
  assert.equal(result.items[0].email, 'p1@x.com');
});

test('approveInternalUserByEmail retorna linha aprovada', async () => {
  const service = loadServiceWithRpc(async (fn, args) => {
    assert.equal(fn, 'approve_internal_user_by_email');
    assert.equal(args.p_email, 'prof@x.com');
    assert.equal(args.p_papel, 'secretaria');
    return {
      data: [{ id: 'u1', email: 'prof@x.com', papel: 'secretaria', ativo: true }],
      error: null,
    };
  });

  const row = await service.approveInternalUserByEmail({
    email: 'prof@x.com',
    papel: 'secretaria',
  });

  assert.equal(row.ativo, true);
  assert.equal(row.papel, 'secretaria');
});

test('approveInternalUserByEmail mapeia usuário não encontrado para 404', async () => {
  const service = loadServiceWithRpc(async () => ({
    data: null,
    error: {
      message: 'usuario nao encontrado para email: teste@x.com',
    },
  }));

  await assert.rejects(
    () =>
      service.approveInternalUserByEmail({
        email: 'teste@x.com',
        papel: 'triagem',
      }),
    error => {
      assert.equal(error.code, 'USER_NOT_FOUND');
      assert.equal(error.statusCode, 404);
      return true;
    }
  );
});
