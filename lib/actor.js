const { getInternalProfile, getUserFromJwt } = require('./supabase');

async function resolveActor(req, allowedRoles = []) {
  const userJwt = req.headers['x-user-jwt'];
  const hasUserJwt = Boolean(userJwt && typeof userJwt === 'string');

  if (!hasUserJwt) {
    const error = new Error('Token do usuario interno ausente');
    error.statusCode = 401;
    error.code = 'INTERNAL_AUTH_REQUIRED';
    throw error;
  }

  let user;
  try {
    user = await getUserFromJwt(userJwt);
  } catch (_error) {
    const error = new Error('Usuario interno invalido');
    error.statusCode = 401;
    error.code = 'INTERNAL_AUTH_INVALID';
    throw error;
  }

  if (!user?.id) {
    const error = new Error('Usuario interno invalido');
    error.statusCode = 401;
    error.code = 'INTERNAL_AUTH_INVALID';
    throw error;
  }

  let profile;
  try {
    profile = await getInternalProfile(user.id);
  } catch (_error) {
    const error = new Error('Falha temporaria ao validar perfil interno');
    error.statusCode = 503;
    error.code = 'INTERNAL_PROFILE_LOOKUP_FAILED';
    throw error;
  }
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
