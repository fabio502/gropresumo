# GrupResumo

Captura mensagens de grupos do **WhatsApp** (via Evolution API) e **Telegram**, gera um **resumo com IA** (Claude) e envia o resumo em **audio** (ElevenLabs) de volta no grupo.

## Fluxo

1. Recebe mensagens do grupo (webhook Evolution / bot Telegram).
2. Armazena no SQLite (`data/grupresumo.db`).
3. Em horario agendado, le a janela de mensagens (padrao 24h).
4. Gera resumo com Claude (`claude-opus-4-7`).
5. Gera MP3 com ElevenLabs.
6. Envia o audio no proprio grupo.

## Requisitos

- Node.js **22+** (usa `node:sqlite` nativo)
- Conta na Evolution API com instancia conectada (WhatsApp)
- Bot do Telegram + token do BotFather (opcional)
- Chaves: Anthropic + ElevenLabs

## Setup

```bash
npm install
npm run build
npm start
```

Em desenvolvimento: `npm run dev`.

**Configuração**: abra `http://localhost:3000/` no navegador para preencher API keys, IDs de grupos e cron pela própria UI. Tudo é persistido em `data/settings.json` e aplicado em hot-reload (sem precisar reiniciar). O `.env` continua funcionando como valor inicial / fallback.

## Configuracao do webhook (WhatsApp)

Aponte a Evolution API para `POST http://SEU_HOST:3000/evolution`, escutando o evento **`MESSAGES_UPSERT`**. Coloque os IDs dos grupos (`...@g.us`) em `WHATSAPP_GROUPS`.

## Configuracao do Telegram

1. Crie o bot com @BotFather, copie o token para `TELEGRAM_BOT_TOKEN`.
2. Adicione o bot ao grupo e desative o **Privacy Mode** (`/setprivacy` no BotFather) para ele ver mensagens.
3. Coloque os chat IDs em `TELEGRAM_GROUPS` (numeros negativos para grupos/supergrupos).

## Agendamento

`SUMMARY_CRON` controla quando o resumo roda (padrao: `0 20 * * *` = todo dia as 20h). `SUMMARY_WINDOW_HOURS` define a janela considerada.

## Disparo manual

```bash
# CLI
npm run summarize -- whatsapp 12036304xxxxx@g.us 24
npm run summarize -- telegram -1001234567890 12

# HTTP
curl -X POST http://localhost:3000/summary/run \
  -H "Content-Type: application/json" \
  -d '{"platform":"whatsapp","groupId":"12036304xxxxx@g.us","windowHours":24}'
```

## Estrutura

```
src/
  index.ts            # boot: HTTP + Telegram + scheduler
  config.ts           # env
  db.ts               # SQLite (node:sqlite)
  types.ts
  routes/webhook.ts   # POST /evolution, /summary/run, /health
  services/
    whatsapp.ts       # parse webhook + sender Evolution
    telegram.ts       # bot Telegraf
    summarizer.ts     # Claude
    tts.ts            # ElevenLabs
    pipeline.ts       # orquestra: ler -> resumir -> TTS -> enviar
    scheduler.ts      # node-cron
  cli/summarize.ts    # disparo manual
```
