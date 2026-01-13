# Lumine API

API de sincronização do Instituto Lumine com Google Sheets.

## Variáveis de Ambiente (configurar no Vercel)

- `SPREADSHEET_ID` - ID da planilha Google Sheets
- `GOOGLE_CREDENTIALS` - JSON completo das credenciais da conta de serviço

## Endpoints

- `GET /api/sync` - Buscar todos os dados
- `POST /api/sync` - Sincronizar dados (action: sync, addChild, addRecord)
