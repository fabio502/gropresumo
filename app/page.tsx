'use client';

import { useEffect, useRef, useState } from 'react';

type Toast = { msg: string; isError?: boolean };

function getNested(obj: any, path: string) {
  return path.split('.').reduce((o, k) => (o ? o[k] : undefined), obj);
}

function setNested(obj: any, path: string, value: any) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    cur[parts[i]] = cur[parts[i]] ?? {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

export default function ConfigPage() {
  const formRef = useRef<HTMLFormElement>(null);
  const [status, setStatus] = useState('carregando…');
  const [toast, setToast] = useState<Toast | null>(null);

  function showToast(msg: string, isError = false) {
    setToast({ msg, isError });
    setTimeout(() => setToast(null), 2500);
  }

  async function load() {
    setStatus('carregando…');
    const r = await fetch('/api/settings');
    const data = await r.json();
    if (!formRef.current) return;
    for (const el of Array.from(formRef.current.elements) as HTMLInputElement[]) {
      if (!el.name) continue;
      const val = getNested(data, el.name);
      if (val == null) continue;
      if (Array.isArray(val)) el.value = val.join(', ');
      else if (el.type === 'password') el.placeholder = val ? `atual: ${val}` : '••••••••';
      else el.value = String(val);
    }
    setStatus('carregado');
  }

  useEffect(() => {
    load();
  }, []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!formRef.current) return;
    const patch: any = {};
    for (const el of Array.from(formRef.current.elements) as HTMLInputElement[]) {
      if (!el.name) continue;
      let value: any = el.value;
      if (el.name.endsWith('.groups')) {
        value = value.split(',').map((s: string) => s.trim()).filter(Boolean);
        if (el.name === 'telegram.groups')
          value = value.map(Number).filter((n: number) => !Number.isNaN(n));
      } else if (el.type === 'number') {
        value = Number(value);
      }
      if (el.type === 'password' && !value) continue;
      setNested(patch, el.name, value);
    }
    const r = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (r.ok) {
      showToast('Configurações salvas');
      load();
    } else {
      const err = await r.json().catch(() => ({}));
      showToast('Erro: ' + (err.error || r.status), true);
    }
  }

  async function runPipeline() {
    const platform = (document.getElementById('run-platform') as HTMLSelectElement).value;
    const groupId = (document.getElementById('run-group') as HTMLInputElement).value.trim();
    const windowHours = Number((document.getElementById('run-window') as HTMLInputElement).value);
    if (!groupId) return showToast('informe o Group ID', true);
    showToast('rodando pipeline…');
    const r = await fetch('/api/summary/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform, groupId, windowHours }),
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok && data.ok) showToast(`OK · ${data.messageCount ?? 0} mensagens resumidas`);
    else showToast('Falha: ' + (data.reason || data.error || r.status), true);
  }

  async function setupTelegramWebhook() {
    showToast('registrando webhook do Telegram…');
    const r = await fetch('/api/telegram/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok && data.ok) showToast(`Webhook OK: ${data.webhook}`);
    else showToast('Falha: ' + (data.error || r.status), true);
  }

  return (
    <>
      <header className="gp-header">
        <h1>GrupResumo · Configuração</h1>
        <span className="hint">{status}</span>
      </header>

      <main className="gp-main">
        <form ref={formRef} onSubmit={onSubmit}>
          <div className="card" style={{ marginBottom: 20 }}>
            <h2>WhatsApp (Evolution API)</h2>
            <div className="grid">
              <div>
                <label>URL da Evolution</label>
                <input name="evolution.url" placeholder="https://sua-evolution.com" />
              </div>
              <div>
                <label>Instância</label>
                <input name="evolution.instance" placeholder="nome_da_instancia" />
              </div>
              <div>
                <label>API Key</label>
                <input name="evolution.apiKey" type="password" placeholder="••••••••" />
                <div className="hint">Em branco mantém a chave salva.</div>
              </div>
              <div>
                <label>Grupos (IDs separados por vírgula)</label>
                <textarea name="evolution.groups" placeholder="1203630xxxxx@g.us, ..." />
              </div>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 20 }}>
            <h2>Telegram</h2>
            <div className="grid">
              <div>
                <label>Bot Token</label>
                <input name="telegram.token" type="password" placeholder="••••••••" />
              </div>
              <div>
                <label>Grupos (chat IDs separados por vírgula)</label>
                <textarea name="telegram.groups" placeholder="-1001234567890, ..." />
              </div>
            </div>
            <div className="actions" style={{ marginTop: 16 }}>
              <button type="button" className="ghost" onClick={setupTelegramWebhook}>
                Registrar webhook do Telegram
              </button>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 20 }}>
            <h2>Anthropic (resumo IA)</h2>
            <div className="grid">
              <div>
                <label>API Key</label>
                <input name="anthropic.apiKey" type="password" placeholder="••••••••" />
              </div>
              <div>
                <label>Modelo</label>
                <input name="anthropic.model" defaultValue="claude-opus-4-7" />
              </div>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 20 }}>
            <h2>ElevenLabs (áudio)</h2>
            <div className="grid">
              <div>
                <label>API Key</label>
                <input name="elevenlabs.apiKey" type="password" placeholder="••••••••" />
              </div>
              <div>
                <label>Voice ID</label>
                <input name="elevenlabs.voiceId" />
              </div>
              <div>
                <label>Modelo</label>
                <input name="elevenlabs.model" defaultValue="eleven_multilingual_v2" />
              </div>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 20 }}>
            <h2>Agendamento</h2>
            <p className="hint" style={{ marginTop: 0 }}>
              O cron é configurado em <code>vercel.json</code> (padrão: 23:00 UTC = 20h horário de Brasília).
            </p>
            <div className="grid">
              <div>
                <label>Janela de mensagens (horas)</label>
                <input name="scheduler.windowHours" type="number" min="1" defaultValue="24" />
              </div>
            </div>
          </div>

          <div className="card">
            <div className="actions">
              <button type="submit">Salvar configurações</button>
              <button type="button" className="ghost" onClick={load}>
                Recarregar
              </button>
            </div>
          </div>
        </form>

        <div className="card">
          <h2>Disparo manual</h2>
          <p className="hint">Roda o pipeline (resumo + áudio) imediatamente para um grupo.</p>
          <div className="grid">
            <div>
              <label>Plataforma</label>
              <select id="run-platform" defaultValue="whatsapp">
                <option value="whatsapp">WhatsApp</option>
                <option value="telegram">Telegram</option>
              </select>
            </div>
            <div>
              <label>Group ID</label>
              <input id="run-group" placeholder="...@g.us ou -100..." />
            </div>
            <div>
              <label>Janela (horas)</label>
              <input id="run-window" type="number" min={1} defaultValue={24} />
            </div>
            <div style={{ display: 'flex', alignItems: 'end' }}>
              <button type="button" onClick={runPipeline}>
                Rodar agora
              </button>
            </div>
          </div>
        </div>
      </main>

      {toast && (
        <div className={`toast show ${toast.isError ? 'error' : ''}`}>{toast.msg}</div>
      )}
    </>
  );
}
