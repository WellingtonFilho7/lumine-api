const test = require('node:test');
const assert = require('node:assert/strict');

function loadActorModule({
  getUserFromJwt = async () => ({ id: 'user-1' }),
  getInternalProfile = async () => ({ ativo: true, papel: 'admin' }),
  env = {},
} = {}) {
  const actorPath = require.resolve('../actor');
  const supabasePath = require.resolve('../supabase');

  delete require.cache[actorPath];
  delete require.cache[supabasePath];

  const previousEnv = {
    REQUIRE_USER_JWT: process.env.REQUIRE_USER_JWT,
    ALLOW_API_TOKEN_FALLBACK: process.env.ALLOW_API_TOKEN_FALLBACK,
    API_TOKEN: process.env.API_TOKEN,
    SUPABASE_ENFORCE_RBAC: process.env.SUPABASE_ENFORCE_RBAC,
  };

  Object.assign(process.env, {
    REQUIRE_USER_JWT: '',
    ALLOW_API_TOKEN_FALLBACK: '',
    API_TOKEN: '',
    SUPABASE_ENFORCE_RBAC: '',
    ...env,
  });

  require.cache[supabasePath] = {
    id: supabasePath,
    filename: supabasePath,
    loaded: true,
    exports: {
      getUserFromJwt,
      getInternalProfile,
    },
  };

  const actor = require('../actor');

  function restore() {
    delete require.cache[actorPath];
    delete require.cache[supabasePath];

    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }

  return { actor, restore };
}

test('resolveActor rejeita request sem JWT por padrão', async () => {
  const { actor, restore } = loadActorModule();

  try {
    await assert.rejects(
      () => actor.resolveActor({ headers: {} }, []),
      error => {
        assert.equal(error.code, 'INTERNAL_AUTH_REQUIRED');
        assert.equal(error.statusCode, 401);
        return true;
      }
    );
  } finally {
    restore();
  }
});

test('resolveActor rejeita fallback legado por Authorization bearer mesmo com API_TOKEN configurado', async () => {
  const { actor, restore } = loadActorModule({
    env: {
      API_TOKEN: 'legacy-token',
      ALLOW_API_TOKEN_FALLBACK: 'true',
    },
  });

  try {
    await assert.rejects(
      () =>
        actor.resolveActor(
          {
            headers: {
              authorization: 'Bearer legacy-token',
            },
          },
          ['admin']
        ),
      error => {
        assert.equal(error.code, 'INTERNAL_AUTH_REQUIRED');
        assert.equal(error.statusCode, 401);
        return true;
      }
    );
  } finally {
    restore();
  }
});

test('resolveActor aceita JWT com perfil interno ativo', async () => {
  const { actor, restore } = loadActorModule({
    getUserFromJwt: async jwt => {
      assert.equal(jwt, 'jwt-valido');
      return { id: 'user-1' };
    },
    getInternalProfile: async id => {
      assert.equal(id, 'user-1');
      return { ativo: true, papel: 'secretaria' };
    },
  });

  try {
    const result = await actor.resolveActor(
      {
        headers: {
          'x-user-jwt': 'jwt-valido',
        },
      },
      ['admin', 'secretaria']
    );

    assert.deepEqual(result, {
      userId: 'user-1',
      role: 'secretaria',
      source: 'jwt',
    });
  } finally {
    restore();
  }
});

test('resolveActor bloqueia perfil sem papel permitido', async () => {
  const { actor, restore } = loadActorModule({
    getInternalProfile: async () => ({ ativo: true, papel: 'triagem' }),
  });

  try {
    await assert.rejects(
      () =>
        actor.resolveActor(
          {
            headers: {
              'x-user-jwt': 'jwt-valido',
            },
          },
          ['admin']
        ),
      error => {
        assert.equal(error.code, 'FORBIDDEN_ROLE');
        assert.equal(error.statusCode, 403);
        return true;
      }
    );
  } finally {
    restore();
  }
});
