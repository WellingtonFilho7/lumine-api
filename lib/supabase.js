const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

let cachedAdmin = null;

function getSupabaseAdmin() {
  if (cachedAdmin) return cachedAdmin;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY sao obrigatorios');
  }

  cachedAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  return cachedAdmin;
}

async function getUserFromJwt(jwt) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.auth.getUser(jwt);
  if (error) throw error;
  return data.user;
}

async function getInternalProfile(userId) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('perfis_internos')
    .select('id, papel, ativo')
    .eq('id', userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

module.exports = {
  getInternalProfile,
  getSupabaseAdmin,
  getUserFromJwt,
};
