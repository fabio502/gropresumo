import cron, { ScheduledTask } from 'node-cron';
import { getConfig } from '../config';
import { onSettingsChange } from '../settings';
import { runSummaryPipeline } from './pipeline';

let task: ScheduledTask | null = null;
let currentExpr = '';
let currentTz = '';

async function runForAllGroups(): Promise<void> {
  const cfg = getConfig();
  console.log(`[scheduler] disparado em ${new Date().toISOString()}`);

  for (const groupId of cfg.evolution.groups) {
    try {
      await runSummaryPipeline('whatsapp', groupId, cfg.scheduler.windowHours);
    } catch (err) {
      console.error(`[scheduler] erro WhatsApp ${groupId}:`, err);
    }
  }
  for (const groupId of cfg.telegram.groups) {
    try {
      await runSummaryPipeline('telegram', String(groupId), cfg.scheduler.windowHours);
    } catch (err) {
      console.error(`[scheduler] erro Telegram ${groupId}:`, err);
    }
  }
}

export function startScheduler(): void {
  applyCron();
  onSettingsChange(applyCron);
}

function applyCron(): void {
  const cfg = getConfig();
  if (!cron.validate(cfg.scheduler.cron)) {
    console.error(`[scheduler] cron invalido, ignorando: ${cfg.scheduler.cron}`);
    return;
  }
  if (cfg.scheduler.cron === currentExpr && cfg.scheduler.timezone === currentTz && task) return;

  if (task) {
    task.stop();
    task = null;
  }

  task = cron.schedule(cfg.scheduler.cron, runForAllGroups, {
    timezone: cfg.scheduler.timezone,
  });
  currentExpr = cfg.scheduler.cron;
  currentTz = cfg.scheduler.timezone;
  console.log(
    `[scheduler] agendado: "${cfg.scheduler.cron}" (${cfg.scheduler.timezone}), janela ${cfg.scheduler.windowHours}h`,
  );
}
