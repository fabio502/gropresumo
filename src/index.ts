import express from 'express';
import path from 'path';
import { paths } from './config';
import { webhookRouter } from './routes/webhook';
import { settingsRouter } from './routes/settings';
import { startScheduler } from './services/scheduler';
import { startTelegramBot } from './services/telegram';
import { loadSettings } from './settings';

async function main() {
  loadSettings();

  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use(settingsRouter);
  app.use(webhookRouter);
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.listen(paths.port, () => {
    console.log(`[http] ouvindo em http://localhost:${paths.port}`);
    console.log(`[http] UI de configuracao: http://localhost:${paths.port}/`);
    console.log('[http] webhook Evolution:  POST /evolution');
  });

  try {
    await startTelegramBot();
  } catch (err) {
    console.error('[telegram] falha ao iniciar bot:', err);
  }

  startScheduler();
}

main().catch((err) => {
  console.error('[main] erro fatal:', err);
  process.exit(1);
});

process.once('SIGINT', () => process.exit(0));
process.once('SIGTERM', () => process.exit(0));
