const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeHeader,
  findColumnIndexes,
  mapCategoryToFolder,
  formatCentsToBrl,
  buildTargetValues,
  isEquivalentCellValue,
} = require('../finance-gastos-shared');

test('normalizeHeader remove acentos e normaliza separadores', () => {
  assert.equal(normalizeHeader('Categoria Detalhada', 0), 'categoria_detalhada');
  assert.equal(normalizeHeader('Mês', 1), 'mes');
  assert.equal(normalizeHeader('', 2), 'col_3');
});

test('findColumnIndexes encontra aliases suportados', () => {
  const headers = ['transaction_id', 'data_transacao', 'tipo', 'categoria', 'valor'];
  const idx = findColumnIndexes(headers);

  assert.equal(idx.transactionId, 0);
  assert.equal(idx.data, 1);
  assert.equal(idx.tipo, 2);
  assert.equal(idx.categoria, 3);
  assert.equal(idx.valor, 4);
});

test('mapCategoryToFolder mapeia categorias oficiais', () => {
  assert.equal(mapCategoryToFolder('aluguel_utilidades'), '01_ALUGUEL_UTILIDADES');
  assert.equal(mapCategoryToFolder('reembolso_voluntario'), '05-Reembolsos');
  assert.equal(mapCategoryToFolder('desconhecida'), '99_OUTROS');
});

test('formatCentsToBrl formata para padrao da planilha', () => {
  assert.equal(formatCentsToBrl(12345), '123,45');
  assert.equal(formatCentsToBrl(0), '');
});

test('buildTargetValues prepara payload para backfill', () => {
  const values = buildTargetValues({
    id: 'abc',
    data_transacao: '2026-03-07',
    tipo: 'gasto',
    categoria: 'servicos_tecnicos',
    descricao: 'Teste',
    valor_centavos: 54321,
    forma_pagamento: 'pix',
    comprovante_path: 'finance/2026/03/file.jpg',
    registrado_por: 'user-1',
    created_at: '2026-03-07T10:00:00.000Z',
  });

  assert.equal(values.transactionId, 'abc');
  assert.equal(values.data, '2026-03-07');
  assert.equal(values.valor, '543,21');
  assert.equal(values.mes, 'Marco');
  assert.equal(values.trimestre, 'T1_Jan-Mar');
  assert.equal(values.categoriaArquivo, '05_SERVICOS_TECNICOS');
});

test('isEquivalentCellValue reconhece igualdade semantica de data e valor', () => {
  assert.equal(isEquivalentCellValue('data', '05/03/2026', '2026-03-05'), true);
  assert.equal(isEquivalentCellValue('valor', 'R$ 123,45', '123,45'), true);
  assert.equal(isEquivalentCellValue('valor', 'R$ 123,46', '123,45'), false);
});
