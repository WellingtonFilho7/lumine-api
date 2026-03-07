const HEADER_ALIASES = {
  transactionId: ['transaction_id', 'id_transacao', 'transacao_id', 'id', 'id_lancamento'],
  data: ['data', 'data_transacao', 'data_lancamento', 'dia'],
  tipo: ['tipo', 'tipo_transacao', 'movimento'],
  categoria: ['categoria', 'categoria_gasto', 'classificacao', 'grupo'],
  descricao: ['descricao', 'historico', 'detalhamento', 'detalhe', 'observacoes', 'observacao', 'item'],
  valor: ['valor', 'valor_r', 'valor_rs', 'total', 'quantia'],
  valorCentavos: ['valor_centavos'],
  formaPagamento: ['forma_pagamento', 'pagamento', 'metodo_pagamento', 'meio_pagamento', 'forma'],
  comprovantePath: ['comprovante_path', 'comprovante', 'anexo', 'arquivo', 'comprovante_url'],
  registradoPor: ['registrado_por', 'user_id', 'responsavel', 'registrado_por_id'],
  createdAt: ['created_at', 'criado_em', 'timestamp', 'data_criacao'],
  origem: ['origem', 'fonte', 'source'],
  ano: ['ano'],
  trimestre: ['trimestre'],
  mes: ['mes', 'mes_referencia'],
  categoriaArquivo: ['categoria_arquivo', 'categoria_pasta'],
};

const MONTH_LABELS = [
  'Janeiro',
  'Fevereiro',
  'Marco',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];

function normalizeText(value, max = 500) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function normalizeHeader(value, index) {
  const normalized = String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (!normalized) return `col_${index + 1}`;
  return normalized;
}

function parseDateInfo(isoDate) {
  const text = normalizeText(isoDate, 32);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;

  const year = Number(text.slice(0, 4));
  const monthIndex = Number(text.slice(5, 7)) - 1;
  if (!Number.isFinite(year) || monthIndex < 0 || monthIndex > 11) return null;

  const monthLabel = MONTH_LABELS[monthIndex];
  const quarter = Math.floor(monthIndex / 3) + 1;
  const quarterLabel =
    quarter === 1
      ? 'T1_Jan-Mar'
      : quarter === 2
      ? 'T2_Abr-Jun'
      : quarter === 3
      ? 'T3_Jul-Set'
      : 'T4_Out-Dez';

  return {
    isoDate: text,
    year: String(year),
    monthLabel,
    quarterLabel,
  };
}

function parseDateFlexible(raw) {
  const value = normalizeText(raw, 100);
  if (!value) return null;

  if (/^\d+(\.\d+)?$/.test(value)) {
    const serial = Number(value);
    if (Number.isFinite(serial) && serial > 1000) {
      const ms = Math.round((serial - 25569) * 86400 * 1000);
      const date = new Date(ms);
      if (!Number.isNaN(date.getTime())) {
        return date.toISOString().slice(0, 10);
      }
    }
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

  const br = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (br) {
    const dd = br[1].padStart(2, '0');
    const mm = br[2].padStart(2, '0');
    const yyyy = br[3];
    return `${yyyy}-${mm}-${dd}`;
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return null;
}

function formatCentsToBrl(cents) {
  const parsed = Number(cents);
  if (!Number.isFinite(parsed) || parsed <= 0) return '';
  return (parsed / 100).toFixed(2).replace('.', ',');
}

function parseCentavos(raw) {
  const value = normalizeText(raw, 200);
  if (!value) return null;

  const cleaned = value
    .replace(/R\$/gi, '')
    .replace(/\s+/g, '')
    .replace(/[^\d,.-]/g, '');

  if (!cleaned) return null;

  let normalized = cleaned;
  if (normalized.includes(',') && normalized.includes('.')) {
    normalized = normalized.replace(/\./g, '').replace(',', '.');
  } else {
    normalized = normalized.replace(',', '.');
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed * 100);
}

function mapCategoryToFolder(categoryRaw) {
  const token = normalizeText(categoryRaw, 120)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (token === 'aluguel_utilidades') return '01_ALUGUEL_UTILIDADES';
  if (token === 'manutencao_reparos') return '02_MANUTENCAO_REPAROS';
  if (token === 'impostos_taxas') return '03_IMPOSTOS_TAXAS';
  if (token === 'tecnologia_e_equipamentos') return '04_TECNOLOGIA_E_EQUIPAMENTOS';
  if (token === 'reembolso_voluntario') return '05-Reembolsos';
  if (token === 'servicos_tecnicos') return '05_SERVICOS_TECNICOS';
  return '99_OUTROS';
}

function findColumnIndexes(headers) {
  const map = {};
  Object.entries(HEADER_ALIASES).forEach(([field, aliases]) => {
    map[field] = headers.findIndex(header => aliases.includes(header));
  });
  return map;
}

function getCell(row, index) {
  if (index < 0) return '';
  return normalizeText(row[index] || '', 500);
}

function buildTargetValues(record, source = 'app_finance') {
  const dateInfo = parseDateInfo(record.data_transacao);
  return {
    transactionId: record.id || '',
    data: record.data_transacao || '',
    tipo: record.tipo || '',
    categoria: record.categoria || '',
    descricao: record.descricao || '',
    valor: formatCentsToBrl(record.valor_centavos),
    valorCentavos: record.valor_centavos || '',
    formaPagamento: record.forma_pagamento || '',
    comprovantePath: record.comprovante_path || '',
    registradoPor: record.registrado_por || '',
    createdAt: record.created_at || '',
    origem: source,
    ano: dateInfo?.year || '',
    trimestre: dateInfo?.quarterLabel || '',
    mes: dateInfo?.monthLabel || '',
    categoriaArquivo: mapCategoryToFolder(record.categoria),
  };
}

function isEquivalentCellValue(field, currentValue, nextValue) {
  const current = normalizeText(currentValue || '', 1000);
  const next = normalizeText(nextValue || '', 1000);
  if (!next) return false;

  if (field === 'data') {
    const currentDate = parseDateFlexible(current);
    const nextDate = parseDateFlexible(next);
    if (currentDate && nextDate) return currentDate === nextDate;
  }

  if (field === 'valor') {
    const currentCents = parseCentavos(current);
    const nextCents = parseCentavos(next);
    if (currentCents !== null && nextCents !== null) {
      return currentCents === nextCents;
    }
  }

  return current === next;
}

module.exports = {
  HEADER_ALIASES,
  normalizeText,
  normalizeHeader,
  parseDateInfo,
  parseDateFlexible,
  formatCentsToBrl,
  parseCentavos,
  mapCategoryToFolder,
  findColumnIndexes,
  getCell,
  buildTargetValues,
  isEquivalentCellValue,
};
