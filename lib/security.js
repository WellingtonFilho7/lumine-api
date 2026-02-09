const ORIGINS_ALLOWLIST = (process.env.ORIGINS_ALLOWLIST || 'https://lumine-webapp.vercel.app')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

const API_TOKEN = process.env.API_TOKEN;
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000);
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 30);

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

function cleanupRateStore(now) {
  for (const [key, value] of rateStore.entries()) {
    if (now - value.windowStart > RATE_LIMIT_WINDOW_MS * 2) {
      rateStore.delete(key);
    }
  }
}

function ensureRateLimit(req, res, action) {
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
