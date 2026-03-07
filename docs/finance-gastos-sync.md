# Finance -> gastos sync

Este fluxo integra os lancamentos do modulo financeiro do app (Supabase) com a aba `gastos` do Google Sheets, sem sobrescrever historico.

## Principio de seguranca

- O script usa `transaction_id` para idempotencia.
- Se o `transaction_id` ja existir na aba, a linha e ignorada.
- O script so insere novas linhas (`INSERT_ROWS`).
- Por padrao roda em `dry-run`.

## Pre-requisitos

Variaveis obrigatorias no shell:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SPREADSHEET_ID`
- `GOOGLE_CREDENTIALS` (JSON da service account) **ou**
- `GOOGLE_CREDENTIALS_FILE` (caminho para o arquivo JSON da service account)

Variaveis opcionais:

- `LEGACY_GASTOS_SHEET_TITLE` (default: `gastos`)
- `LEGACY_GASTOS_RANGE` (default: `<sheet>!A:ZZ`)
- `FINANCE_EXPORT_PAGE_SIZE` (default: `1000`)
- `FINANCE_EXPORT_BATCH_SIZE` (default: `200`)
- `FINANCE_GASTOS_SOURCE` (default: `app_finance`)

## Cabecalho minimo na aba `gastos`

A aba precisa ter uma coluna de ID para deduplicacao:

- recomendado: `transaction_id`

O script mapeia automaticamente aliases comuns para:

- data, tipo, categoria, descricao, valor, forma_pagamento, comprovante_path, registrado_por, created_at
- ano, trimestre, mes, categoria_arquivo, origem (se existirem)

## Execucao

Dry-run:

```bash
export GOOGLE_CREDENTIALS_FILE="/caminho/service-account.json"
npm run export:finance:gastos
```

Aplicar:

```bash
npm run export:finance:gastos -- --apply
```

## Backfill de linhas ja existentes

Quando os registros ja estao na aba `gastos`, mas algumas colunas ficaram vazias
(ex.: cabecalho antigo), rode o backfill para atualizar essas linhas por
`transaction_id` sem inserir novas.

Dry-run do backfill:

```bash
npm run backfill:finance:gastos
```

Aplicar backfill:

```bash
npm run backfill:finance:gastos -- --apply
```

## Operacao recomendada

1. Rodar dry-run e validar `rowsToAppend`.
2. Rodar com `--apply`.
3. Repetir quando necessario (idempotente por `transaction_id`).
