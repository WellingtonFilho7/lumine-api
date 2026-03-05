const test = require('node:test');
const assert = require('node:assert/strict');

function loadValidation() {
  const modulePath = require.resolve('../finance-validation');
  delete require.cache[modulePath];
  return require('../finance-validation');
}

test('create payload converte valor textual para centavos', () => {
  const { parseFinanceCreatePayload } = loadValidation();
  const payload = parseFinanceCreatePayload({
    tipo: 'gasto',
    descricao: 'Compra material pedagógico',
    categoria: 'operacional',
    valor: '149,90',
    data: '2026-03-04',
    formaPagamento: 'pix',
    comprovantePath: 'finance/2026/03/user-x/recibo.pdf',
  });

  assert.equal(payload.valorCentavos, 14990);
  assert.equal(payload.tipo, 'gasto');
});

test('create payload rejeita comprovantePath invalido', () => {
  const { parseFinanceCreatePayload } = loadValidation();
  assert.throws(() => {
    parseFinanceCreatePayload({
      tipo: 'doacao',
      descricao: 'Doação',
      categoria: 'campanha',
      valorCentavos: 1000,
      data: '2026-03-04',
      formaPagamento: 'dinheiro',
      comprovantePath: '../fora.pdf',
    });
  }, /comprovantePath|Payload invalido|invalido/i);
});

test('upload-url rejeita mime nao permitido', () => {
  const { parseFinanceUploadUrlPayload } = loadValidation();
  assert.throws(() => {
    parseFinanceUploadUrlPayload({
      fileName: 'comprovante.exe',
      contentType: 'application/x-msdownload',
      fileSizeBytes: 1024,
    });
  }, /contentType|Payload invalido|invalido/i);
});

test('upload-url respeita FINANCE_ALLOWED_MIME configurado por ambiente', () => {
  const previous = process.env.FINANCE_ALLOWED_MIME;
  process.env.FINANCE_ALLOWED_MIME = 'application/pdf';

  try {
    const { parseFinanceUploadUrlPayload } = loadValidation();
    assert.throws(() => {
      parseFinanceUploadUrlPayload({
        fileName: 'imagem.png',
        contentType: 'image/png',
        fileSizeBytes: 1024,
      });
    }, /contentType|Payload invalido|invalido/i);
  } finally {
    if (previous === undefined) {
      delete process.env.FINANCE_ALLOWED_MIME;
    } else {
      process.env.FINANCE_ALLOWED_MIME = previous;
    }
  }
});

test('list query normaliza limite e cursor', () => {
  const { parseFinanceListQuery } = loadValidation();
  const query = parseFinanceListQuery({ limit: '50', cursor: '123', tipo: 'doacao' });

  assert.equal(query.limit, 50);
  assert.equal(query.cursor, '123');
  assert.equal(query.tipo, 'doacao');
});

test('file-url normaliza expiresIn dentro do limite', () => {
  const { parseFinanceFileUrlPayload } = loadValidation();
  const payload = parseFinanceFileUrlPayload({
    comprovantePath: 'finance/2026/03/user-x/recibo.pdf',
    expiresIn: '180',
  });

  assert.equal(payload.expiresIn, 180);
});
