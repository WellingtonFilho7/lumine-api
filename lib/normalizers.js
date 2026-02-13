function toText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function normalizeAsciiToken(value) {
  return toText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function normalizeYesNo(value) {
  const token = normalizeAsciiToken(value);
  if (!token) return '';
  if (['sim', 'yes', 'true', '1'].includes(token)) return 'sim';
  if (['nao', 'no', 'false', '0'].includes(token)) return 'nao';
  return token;
}

function normalizeSchoolShift(value) {
  const token = normalizeAsciiToken(value);
  const map = {
    manha: 'manha',
    tarde: 'tarde',
    integral: 'integral',
  };
  return map[token] || token;
}

function normalizeReferralSource(value) {
  const token = normalizeAsciiToken(value);
  const map = {
    igreja: 'igreja',
    escola: 'escola',
    cras: 'CRAS',
    indicacao: 'indicacao',
    redes_sociais: 'redes_sociais',
    redessociais: 'redes_sociais',
    outro: 'outro',
  };
  return map[token] || token;
}

function normalizePriority(value) {
  const token = normalizeAsciiToken(value);
  const map = {
    alta: 'alta',
    media: 'media',
    baixa: 'baixa',
  };
  return map[token] || token;
}

function normalizeImageConsent(value) {
  const token = normalizeAsciiToken(value);
  if (!token) return '';
  if (['interno', 'internal', 'uso_interno'].includes(token)) return 'interno';
  if (['comunicacao', 'communication'].includes(token)) return 'comunicacao';
  if (['nao', 'nenhum', 'none'].includes(token)) return '';
  return token;
}

function normalizeClassGroup(value) {
  const token = normalizeAsciiToken(value);
  const map = {
    pre_alfabetizacao: 'pre_alfabetizacao',
    alfabetizacao: 'alfabetizacao',
    fundamental_1: 'fundamental_1',
    fundamental_2: 'fundamental_2',
  };
  return map[token] || token;
}

function normalizeFormaChegada(value) {
  const token = normalizeAsciiToken(value);
  const map = {
    a_pe: 'a_pe',
    ape: 'a_pe',
    transporte_escolar: 'transporte_escolar',
    levada_responsavel: 'levada_responsavel',
    outro: 'outro',
  };
  return map[token] || token;
}

function normalizeDocumentKey(value) {
  const token = normalizeAsciiToken(value).replace(/\s+/g, '_');
  const map = {
    certidao_nascimento: 'certidao_nascimento',
    documento_responsavel: 'documento_responsavel',
    comprovante_residencia: 'comprovante_residencia',
    carteira_vacinacao: 'carteira_vacinacao',
  };
  return map[token] || token;
}

function normalizeDocuments(value) {
  if (value == null) return [];

  const list = Array.isArray(value)
    ? value
    : String(value)
        .split(/[|,]/)
        .map(item => item.trim())
        .filter(Boolean);

  const normalized = [];
  for (const item of list) {
    const key = normalizeDocumentKey(item);
    if (!normalized.includes(key)) normalized.push(key);
  }
  return normalized;
}

function coerceBoolean(value) {
  if (value === true || value === false) return value;
  if (value == null || value === '') return undefined;
  const token = normalizeAsciiToken(value);
  if (['true', '1', 'sim', 'yes'].includes(token)) return true;
  if (['false', '0', 'nao', 'no'].includes(token)) return false;
  return undefined;
}

module.exports = {
  coerceBoolean,
  normalizeAsciiToken,
  normalizeClassGroup,
  normalizeDocumentKey,
  normalizeDocuments,
  normalizeFormaChegada,
  normalizeImageConsent,
  normalizePriority,
  normalizeReferralSource,
  normalizeSchoolShift,
  normalizeYesNo,
};
