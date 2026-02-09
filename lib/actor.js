const { getInternalProfile, getUserFromJwt } = require('./supabase');

const SUPABASE_ENFORCE_RBAC = process.env.SUPABASE_ENFORCE_RBAC === 'true';

async function resolveActor(req, allowedRoles = []) {
  const userJwt = req.headers['x-user-jwt'];

  if (!SUPABASE_ENFORCE_RBAC) {
    return {
      userId: null,
      role: 'system',
      source: userJwt ? 'jwt_optional' : 'system',
    };
  }

  if (!userJwt || typeof userJwt !== 'string') {
    const error = new Error('Token do usuario interno ausente');
    error.statusCode = 401;
    error.code = 'INTERNAL_AUTH_REQUIRED';
    throw error;
  }

  const user = await getUserFromJwt(userJwt);
  if (!user?.id) {
    const error = new Error('Usuario interno invalido');
    error.statusCode = 401;
    error.code = 'INTERNAL_AUTH_INVALID';
    throw error;
  }

  const profile = await getInternalProfile(user.id);
  if (!profile || !profile.ativo) {
    const error = new Error('Perfil interno inativo ou inexistente');
    error.statusCode = 403;
    error.code = 'INTERNAL_PROFILE_INVALID';
    throw error;
  }

  if (allowedRoles.length > 0 && !allowedRoles.includes(profile.papel)) {
    const error = new Error('Permissao insuficiente');
    error.statusCode = 403;
    error.code = 'FORBIDDEN_ROLE';
    throw error;
  }

  return {
    userId: user.id,
    role: profile.papel,
    source: 'jwt',
  };
}

module.exports = {
  resolveActor,
};
