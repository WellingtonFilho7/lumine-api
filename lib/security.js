const ORIGINS_ALLOWLIST = (process.env.ORIGINS_ALLOWLIST || 'https://lumine-webapp.vercel.app')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

const API_TOKEN = process.env.API_TOKEN;
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000);
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 30);
const UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL || '';
const UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const RATE_LIMIT_NAMESPACE = process.env.RATE_LIMIT_NAMESPACE || 'lumine:rate';
const USE_UPSTASH_RATE_LIMIT = Boolean(UPSTASH_REDIS_REST_URL && UPSTASH_REDIS_REST_TOKEN);

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

async function upstashRequest(commandPath) {
  const response = await fetch(`${UPSTASH_REDIS_REST_URL}/${commandPath}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Upstash HTTP ${response.status}`);
  }

  const payload = await response.json().catch(() => null);
  if (!payload || typeof payload.result === 'undefined') {
    throw new Error('Resposta invalida do Upstash');
  }

  return payload.result;
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

async function ensureRateLimit(req, res, action) {
  if (!USE_UPSTASH_RATE_LIMIT) {
    return ensureRateLimitMemory(req, res, action);
  }

  const ip = getClientIp(req);
  const key = `${RATE_LIMIT_NAMESPACE}:${action}:${ip}`;
  const encodedKey = encodeURIComponent(key);

  try {
    const countResult = await upstashRequest(`incr/${encodedKey}`);
    const count = Number(countResult || 0);

    if (count === 1) {
      await upstashRequest(`pexpire/${encodedKey}/${RATE_LIMIT_WINDOW_MS}`);
    }

    if (count > RATE_LIMIT_MAX) {
      res.status(429).json({
        success: false,
        error: 'RATE_LIMITED',
        message: 'Muitas requisicoes. Tente novamente em instantes.',
      });
      return false;
    }

    return true;
  } catch (error) {
    console.error('[rate-limit] upstash indisponivel, fallback memoria', {
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
