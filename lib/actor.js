const { getInternalProfile, getUserFromJwt } = require('./supabase');

const SUPABASE_ENFORCE_RBAC = process.env.SUPABASE_ENFORCE_RBAC === 'true';
const REQUIRE_USER_JWT = (process.env.REQUIRE_USER_JWT || 'false').toLowerCase() !== 'false';
const ALLOW_API_TOKEN_FALLBACK =
  (process.env.ALLOW_API_TOKEN_FALLBACK || 'true').toLowerCase() === 'true';
const API_TOKEN = process.env.API_TOKEN || '';

function hasValidApiToken(req) {
  const authHeader = req.headers.authorization || '';
  return Boolean(API_TOKEN && authHeader === `Bearer ${API_TOKEN}`);
}

async function resolveActor(req, allowedRoles = []) {
  const userJwt = req.headers['x-user-jwt'];
  const hasUserJwt = Boolean(userJwt && typeof userJwt === 'string');
  const allowApiTokenFallback = ALLOW_API_TOKEN_FALLBACK && hasValidApiToken(req);
  const mustUseJwt = SUPABASE_ENFORCE_RBAC || REQUIRE_USER_JWT;

  if (!hasUserJwt && allowApiTokenFallback) {
    return {
      userId: null,
      role: 'admin',
      source: 'api_token_fallback',
    };
  }

  if (!hasUserJwt && !mustUseJwt) {
    return {
      userId: null,
      role: 'system',
      source: 'system',
    };
  }

  if (!hasUserJwt) {
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
