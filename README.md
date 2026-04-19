# GrupResumo

Captura mensagens de grupos do **WhatsApp** (via Evolution API) e **Telegram**, gera **resumo com IA** (Claude) e envia o resumo em **áudio** (ElevenLabs) de volta no grupo.

Stack: **Next.js 15 (App Router) + Postgres + Vercel Cron** — pronto para deploy na Vercel.

## Fluxo

1. Webhook da Evolution / webhook do Telegram chega no app.
2. Mensagem é gravada no Postgres.
3. Vercel Cron dispara `/api/cron/summary` no horário configurado.
4. Pipeline lê janela de mensagens, gera resumo com Claude, gera MP3 com ElevenLabs.
5. Áudio é enviado de volta no grupo.

## Deploy na Vercel

1. **Postgres**: instale o **Neon** (ou outro Postgres) via Marketplace da Vercel — ele cria `DATABASE_URL` automático.
2. **Variáveis de ambiente** no Vercel:
   - `DATABASE_URL` (vem do Marketplace)
   - `CRON_SECRET` — string aleatória (Vercel envia `Authorization: Bearer ${CRON_SECRET}` para o cron)
   - `APP_URL` (opcional) — URL pública, usada para registrar webhook do Telegram
3. **Deploy** (`vercel --prod` ou push no GitHub conectado).
4. **Configurar pela UI**: abra o domínio do app, preencha API keys e IDs de grupos.
5. **Apontar webhooks externos**:
   - Evolution API → `POST https://SEU_APP/api/evolution` (evento `MESSAGES_UPSERT`)
   - Telegram: clique no botão **Registrar webhook do Telegram** na UI (chama `setWebhook` automaticamente).

## Cron

`vercel.json` agenda `/api/cron/summary` para `0 23 * * *` (UTC) — equivale a 20h horário de Brasília. Edite o `schedule` se quiser outro horário (lembre que Vercel Cron usa UTC).

## Dev local

```bash
cp .env.example .env.local   # preencha DATABASE_URL e (opcional) outras
npm install
npm run dev
```

Abra `http://localhost:3000`.

## Endpoints

| Rota | Método | Descrição |
|---|---|---|
| `/` | GET | UI de configuração |
| `/api/settings` | GET / PUT | Lê e atualiza settings (no Postgres) |
| `/api/evolution` | POST | Webhook Evolution API |
| `/api/telegram` | POST | Webhook Telegram |
| `/api/telegram/webhook` | POST / DELETE | Registra/remove o webhook do Telegram |
| `/api/summary/run` | POST | Disparo manual do pipeline |
| `/api/cron/summary` | GET | Endpoint do Vercel Cron (autenticado) |

## Estrutura

```
app/                      # Next.js App Router
  layout.tsx, page.tsx    # UI de config
  globals.css
  api/
    settings/route.ts
    evolution/route.ts
    telegram/route.ts
    telegram/webhook/route.ts
    summary/run/route.ts
    cron/summary/route.ts
src/
  config.ts, settings.ts, types.ts
  db.ts                   # Postgres (postgres.js)
  services/
    whatsapp.ts, telegram.ts
    summarizer.ts, tts.ts
    pipeline.ts
vercel.json               # Vercel Cron
```
