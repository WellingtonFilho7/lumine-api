const { createHash } = require('crypto');
const { getSupabaseAdmin } = require('./supabase');

const ORIGINS_ALLOWLIST = (process.env.ORIGINS_ALLOWLIST || 'https://lumine-webapp.vercel.app')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

const API_TOKEN = process.env.API_TOKEN;
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000);
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 30);
const RATE_LIMIT_NAMESPACE = process.env.RATE_LIMIT_NAMESPACE || 'lumine:rate';
const RATE_LIMIT_USE_SUPABASE =
  (process.env.RATE_LIMIT_USE_SUPABASE || 'true').toLowerCase() !== 'false';
const RATE_LIMIT_CLEANUP_PROBABILITY = Number(
  process.env.RATE_LIMIT_CLEANUP_PROBABILITY || 0.02
);

const rateStore = new Map();

function getAllowedOrigin(origin) {
  if (!origin) return '';
  return ORIGINS_ALLOWLIST.includes(origin) ? origin : '';
}

function setCors(req, res) {
  const origin = req.headers.origin;
  const allowedOrigin = getAllowedOrigin(origin);
  if (allowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Authorization, Content-Type, X-Device-Id, X-App-Version'
  );
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  return { origin, allowedOrigin };
}

function ensureCors(req, res, origin, allowedOrigin) {
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return false;
  }

  if (origin && !allowedOrigin) {
    res.status(403).json({
      success: false,
      error: 'FORBIDDEN_ORIGIN',
      message: 'Origem nao permitida',
    });
    return false;
  }

  return true;
}

function ensureApiToken(req, res) {
  const authHeader = req.headers.authorization || '';
  if (!API_TOKEN || authHeader !== `Bearer ${API_TOKEN}`) {
    res.status(401).json({
      success: false,
      error: 'UNAUTHORIZED',
      message: 'Nao autorizado',
    });
    return false;
  }
  return true;
}

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (Array.isArray(xff) && xff.length) return xff[0].split(',')[0].trim();
  if (typeof xff === 'string' && xff) return xff.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

function hashIp(ip) {
  return createHash('sha256').update(String(ip || 'unknown')).digest('hex');
}

function cleanupRateStore(now) {
  for (const [key, value] of rateStore.entries()) {
    if (now - value.windowStart > RATE_LIMIT_WINDOW_MS * 2) {
      rateStore.delete(key);
    }
  }
}

function ensureRateLimitMemory(req, res, action) {
  const now = Date.now();
  cleanupRateStore(now);

  const ip = getClientIp(req);
  const key = `${action}:${ip}`;
  const current = rateStore.get(key);

  if (!current || now - current.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateStore.set(key, { windowStart: now, count: 1 });
    return true;
  }

  current.count += 1;
  rateStore.set(key, current);

  if (current.count > RATE_LIMIT_MAX) {
    res.status(429).json({
      success: false,
      error: 'RATE_LIMITED',
      message: 'Muitas requisicoes. Tente novamente em instantes.',
    });
    return false;
  }

  return true;
}

function buildRateLimitKey(action, ipHash, windowStartMs) {
  return `${RATE_LIMIT_NAMESPACE}:${action}:${ipHash}:${windowStartMs}`;
}

async function maybeCleanupSupabaseRateLimits(supabase, nowMs) {
  if (Math.random() > RATE_LIMIT_CLEANUP_PROBABILITY) return;

  const cutoff = new Date(nowMs - RATE_LIMIT_WINDOW_MS * 10).toISOString();
  await supabase.from('api_rate_limits').delete().lt('updated_at', cutoff);
}

async function ensureRateLimitSupabase(req, res, action) {
  const supabase = getSupabaseAdmin();
  const nowMs = Date.now();
  const windowStartMs = Math.floor(nowMs / RATE_LIMIT_WINDOW_MS) * RATE_LIMIT_WINDOW_MS;
  const ipHash = hashIp(getClientIp(req));
  const key = buildRateLimitKey(action, ipHash, windowStartMs);

  const { data, error } = await supabase.rpc('consume_rate_limit', {
    p_key: key,
    p_window_start: new Date(windowStartMs).toISOString(),
    p_max: RATE_LIMIT_MAX,
  });

  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  const allowed = Boolean(row?.allowed);

  if (!allowed) {
    res.status(429).json({
      success: false,
      error: 'RATE_LIMITED',
      message: 'Muitas requisicoes. Tente novamente em instantes.',
    });
    return false;
  }

  await maybeCleanupSupabaseRateLimits(supabase, nowMs);
  return true;
}

async function ensureRateLimit(req, res, action) {
  if (!RATE_LIMIT_USE_SUPABASE) {
    return ensureRateLimitMemory(req, res, action);
  }

  try {
    return await ensureRateLimitSupabase(req, res, action);
  } catch (error) {
    console.error('[rate-limit] supabase indisponivel, fallback memoria', {
      message: error?.message,
    });
    return ensureRateLimitMemory(req, res, action);
  }
}

function sanitizeText(value, max = 500) {
  if (value === null || value === undefined) return '';
  const stringValue = String(value)
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return stringValue.slice(0, max);
}

function sanitizeOptional(value, max = 500) {
  const normalized = sanitizeText(value, max);
  return normalized || null;
}

function ensureHoneypot(req, res) {
  const honeypot = req.body?.website;
  if (honeypot && String(honeypot).trim()) {
    res.status(400).json({
      success: false,
      error: 'INVALID_REQUEST',
      message: 'Requisicao invalida',
    });
    return false;
  }
  return true;
}

module.exports = {
  ensureApiToken,
  ensureCors,
  ensureHoneypot,
  ensureRateLimit,
  getAllowedOrigin,
  sanitizeOptional,
  sanitizeText,
  setCors,
};
