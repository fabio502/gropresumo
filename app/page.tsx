'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type Platform = 'whatsapp' | 'telegram';

interface DashboardData {
  ok: boolean;
  ranAt: string;
  stats: {
    messages24h: number;
    messages24hDeltaPct: number;
    groupsActive: number;
    groupsCapacity: number;
    summariesMonth: number;
    summariesWeek: number;
    audioMsMonth: number;
  };
  activity: { day: string; messages: number; summaries: number; audioMs: number }[];
  nextRuns: {
    platform: Platform;
    groupId: string;
    groupName: string;
    scheduledAt: number;
    windowHours: number;
    kind: string;
  }[];
  recentSummaries: {
    id: number;
    platform: Platform;
    groupId: string;
    groupName: string | null;
    windowStart: number;
    windowEnd: number;
    text: string;
    messageCount: number;
    audioMs: number;
    createdAt: number;
  }[];
  recentMessages: {
    id: number;
    platform: Platform;
    groupId: string;
    groupName: string | null;
    senderName: string;
    content: string;
    timestamp: number;
  }[];
  services: {
    key: string;
    name: string;
    short: string;
    detail: string;
    state: 'ok' | 'warn' | 'off';
  }[];
  config: {
    scheduleCron: string;
    scheduleTz: string;
    windowHours: number;
    nextRunAt: number | null;
  };
}

type View = 'painel' | 'resumos' | 'mensagens' | 'grupos' | 'integracoes' | 'config' | 'logs';

const VIEW_LABELS: Record<View, string> = {
  painel: 'Painel',
  resumos: 'Resumos',
  mensagens: 'Mensagens',
  grupos: 'Grupos',
  integracoes: 'Integrações',
  config: 'Configurações',
  logs: 'Logs',
};

function formatNumber(n: number): string {
  return n.toLocaleString('pt-BR');
}

function formatAudioTime(ms: number): { value: string; small?: string } {
  if (!ms || ms <= 0) return { value: '0', small: 'm' };
  const totalMin = Math.round(ms / 60000);
  if (totalMin < 60) return { value: String(totalMin), small: 'm' };
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? { value: `${h}h ${m}`, small: 'm' } : { value: String(h), small: 'h' };
}

function formatTimeHM(ms: number): string {
  return new Date(ms).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  });
}

function formatDayShort(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso + 'T12:00:00Z');
  return d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '').slice(0, 3);
}

function formatRelative(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'agora';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return new Date(ms).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

function extractTitle(text: string): { title: string; body: string } {
  if (!text) return { title: '', body: '' };
  const firstLine = text.split('\n').find((l) => l.trim().length > 0) ?? '';
  const cleaned = firstLine.replace(/^#+\s*/, '').replace(/\*\*/g, '');
  if (cleaned.length > 110) {
    return { title: cleaned.slice(0, 110).trim() + '…', body: text };
  }
  const rest = text.slice(firstLine.length).trim();
  return { title: cleaned || 'Resumo gerado', body: rest || text };
}

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

function buildAreaChart(data: { day: string; value: number }[]) {
  if (!data.length) return { area: '', line: '', points: [] as { x: number; y: number; value: number }[], maxLabel: '0' };
  const w = 720;
  const h = 200;
  const max = Math.max(...data.map((d) => d.value), 1);
  const step = w / Math.max(data.length - 1, 1);
  const points = data.map((d, i) => ({
    x: i * step,
    y: h - (d.value / max) * (h - 20) - 10,
    value: d.value,
  }));
  const line = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(' ');
  const area = `${line} L${w},${h + 40} L0,${h + 40} Z`;
  return { area, line, points, maxLabel: String(max) };
}

interface ManualIntent {
  platform?: Platform;
  groupId?: string;
  mode?: 'preview' | 'run';
  nonce: number;
}

type HealthState = 'ok' | 'warn' | 'off';

export default function ConsolePage() {
  const [view, setView] = useState<View>('painel');
  const [toast, setToast] = useState<{ msg: string; err?: boolean } | null>(null);
  const [resumosFilter, setResumosFilter] = useState<{ groupId?: string; nonce: number }>({ nonce: 0 });
  const [manualIntent, setManualIntent] = useState<ManualIntent>({ nonce: 0 });
  const [query, setQuery] = useState('');
  const [health, setHealth] = useState<HealthState>('warn');
  const [healthDetail, setHealthDetail] = useState('checando…');
  const toastTimer = useRef<any>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const showToast = useCallback((msg: string, err = false) => {
    setToast({ msg, err });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }, []);

  const navigate = useCallback((v: View) => setView(v), []);

  const openManual = useCallback((intent: Omit<ManualIntent, 'nonce'> = {}) => {
    setView('painel');
    setManualIntent({ ...intent, nonce: Date.now() });
  }, []);

  const openResumos = useCallback((groupId?: string) => {
    setView('resumos');
    setResumosFilter({ groupId, nonce: Date.now() });
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function ping() {
      const started = Date.now();
      try {
        const r = await fetch('/api/health', { cache: 'no-store' });
        const j = await r.json().catch(() => ({}));
        if (cancelled) return;
        const ms = Date.now() - started;
        if (j?.ok) {
          setHealth('ok');
          setHealthDetail(`db ok · ${ms}ms`);
        } else {
          setHealth('warn');
          setHealthDetail(j?.error ?? `status ${r.status}`);
        }
      } catch (err: any) {
        if (cancelled) return;
        setHealth('off');
        setHealthDetail(err?.message ?? 'offline');
      }
    }
    ping();
    const t = setInterval(ping, 30_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (e.key === 'Escape' && document.activeElement === searchRef.current) {
        setQuery('');
        searchRef.current?.blur();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!query.trim()) return;
    if (view !== 'resumos' && view !== 'mensagens' && view !== 'logs') setView('resumos');
  }, [query]);

  return (
    <div className="app">
      <Sidebar current={view} onNavigate={setView} />
      <main className="main">
        <Topbar
          current={view}
          onRunNow={() => openManual()}
          query={query}
          onQuery={setQuery}
          searchRef={searchRef}
          health={health}
          healthDetail={healthDetail}
        />
        <div className="content">
          {view === 'painel' && (
            <Painel
              showToast={showToast}
              navigate={navigate}
              openManual={openManual}
              openResumos={openResumos}
              manualIntent={manualIntent}
            />
          )}
          {view === 'resumos' && <Resumos filter={resumosFilter} query={query} />}
          {view === 'mensagens' && <Mensagens query={query} />}
          {view === 'grupos' && <Grupos openManual={openManual} />}
          {view === 'integracoes' && <Integracoes navigate={navigate} />}
          {view === 'config' && <Configuracoes showToast={showToast} />}
          {view === 'logs' && <Logs query={query} health={health} healthDetail={healthDetail} />}
        </div>
      </main>
      {toast && <div className={`toast show ${toast.err ? 'err' : ''}`}>{toast.msg}</div>}
    </div>
  );
}

/* ------------------------------- SIDEBAR ------------------------------- */

function Sidebar({ current, onNavigate }: { current: View; onNavigate: (v: View) => void }) {
  const items: { v: View; label: string; icon: React.ReactNode; group: 'op' | 'sys' }[] = [
    {
      v: 'painel',
      label: 'Painel',
      group: 'op',
      icon: (
        <svg className="nav-ico" viewBox="0 0 24 24">
          <rect x="3" y="3" width="7" height="9" />
          <rect x="14" y="3" width="7" height="5" />
          <rect x="14" y="12" width="7" height="9" />
          <rect x="3" y="16" width="7" height="5" />
        </svg>
      ),
    },
    {
      v: 'resumos',
      label: 'Resumos',
      group: 'op',
      icon: (
        <svg className="nav-ico" viewBox="0 0 24 24">
          <path d="M4 4h16v16H4z" />
          <path d="M8 9h8M8 13h8M8 17h5" />
        </svg>
      ),
    },
    {
      v: 'mensagens',
      label: 'Mensagens',
      group: 'op',
      icon: (
        <svg className="nav-ico" viewBox="0 0 24 24">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      ),
    },
    {
      v: 'grupos',
      label: 'Grupos',
      group: 'op',
      icon: (
        <svg className="nav-ico" viewBox="0 0 24 24">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      ),
    },
    {
      v: 'integracoes',
      label: 'Integrações',
      group: 'sys',
      icon: (
        <svg className="nav-ico" viewBox="0 0 24 24">
          <path d="M16 18l6-6-6-6M8 6l-6 6 6 6" />
        </svg>
      ),
    },
    {
      v: 'config',
      label: 'Configurações',
      group: 'sys',
      icon: (
        <svg className="nav-ico" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      ),
    },
    {
      v: 'logs',
      label: 'Logs',
      group: 'sys',
      icon: (
        <svg className="nav-ico" viewBox="0 0 24 24">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
        </svg>
      ),
    },
  ];

  return (
    <aside className="side">
      <div className="brand">
        <div className="brand-mark">
          <span>G</span>
        </div>
        <div className="brand-text">
          <b>GrupResumo</b>
          <small>v 1.0 · Console</small>
        </div>
      </div>
      <nav className="nav">
        <div className="nav-label">Operação</div>
        {items
          .filter((i) => i.group === 'op')
          .map((i) => (
            <button
              key={i.v}
              className={`nav-item ${current === i.v ? 'active' : ''}`}
              onClick={() => onNavigate(i.v)}
            >
              {i.icon}
              {i.label}
            </button>
          ))}
        <div className="nav-label">Sistema</div>
        {items
          .filter((i) => i.group === 'sys')
          .map((i) => (
            <button
              key={i.v}
              className={`nav-item ${current === i.v ? 'active' : ''}`}
              onClick={() => onNavigate(i.v)}
            >
              {i.icon}
              {i.label}
            </button>
          ))}
      </nav>
      <div className="acct">
        <div className="av">GR</div>
        <div>
          <div className="name">Workspace</div>
          <div className="role">admin</div>
        </div>
        <div className="dot" />
      </div>
    </aside>
  );
}

/* -------------------------------- TOPBAR -------------------------------- */

function Topbar({
  current,
  onRunNow,
  query,
  onQuery,
  searchRef,
  health,
  healthDetail,
}: {
  current: View;
  onRunNow: () => void;
  query: string;
  onQuery: (v: string) => void;
  searchRef: React.MutableRefObject<HTMLInputElement | null>;
  health: HealthState;
  healthDetail: string;
}) {
  const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);
  const pillLabel = health === 'ok' ? 'ao vivo' : health === 'warn' ? 'checando' : 'offline';
  const pillClass = health === 'ok' ? '' : health === 'warn' ? 'warn' : 'off';
  return (
    <div className="top">
      <div className="crumb">
        <span className="c-key">Workspace</span>
        <span className="c-sep">/</span>
        <span className="c-cur">{VIEW_LABELS[current]}</span>
      </div>
      <div className="top-c">
        <div className="search">
          <svg className="search-ico" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Buscar resumos, mensagens, grupos…"
            aria-label="Buscar"
          />
          {query ? (
            <button
              type="button"
              className="search-clear"
              onClick={() => onQuery('')}
              aria-label="Limpar busca"
              title="Limpar (Esc)"
            >
              ×
            </button>
          ) : (
            <kbd className="kbd" title="Foco na busca">
              {isMac ? '⌘' : 'Ctrl'} K
            </kbd>
          )}
        </div>
      </div>
      <div className="top-r">
        <div className={`pill`} title={healthDetail}>
          <span className={`pdot ${pillClass}`} />
          {pillLabel}
        </div>
        <button className="btn" onClick={onRunNow} title="Abrir disparo manual no Painel">
          <svg width="13" height="13" viewBox="0 0 24 24">
            <polygon points="5 3 19 12 5 21 5 3" fill="currentColor" />
          </svg>
          Rodar agora
        </button>
      </div>
    </div>
  );
}

/* -------------------------------- PAINEL -------------------------------- */

function Painel({
  showToast,
  navigate,
  openManual,
  openResumos,
  manualIntent,
}: {
  showToast: (msg: string, err?: boolean) => void;
  navigate: (v: View) => void;
  openManual: (intent?: { platform?: Platform; groupId?: string; mode?: 'preview' | 'run' }) => void;
  openResumos: (groupId?: string) => void;
  manualIntent: ManualIntent;
}) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [metric, setMetric] = useState<'messages' | 'summaries' | 'audioMs'>('summaries');
  const [error, setError] = useState<string | null>(null);
  const manualRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (manualIntent.nonce === 0) return;
    manualRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [manualIntent.nonce]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/dashboard', { cache: 'no-store' });
      const json = await r.json();
      if (!r.ok || !json.ok) throw new Error(json.error ?? `status ${r.status}`);
      setData(json as DashboardData);
    } catch (err: any) {
      setError(err?.message ?? 'erro ao carregar');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  const chart = useMemo(() => {
    const rows = data?.activity ?? [];
    const series = rows.map((r) => ({
      day: r.day,
      value: metric === 'audioMs' ? Math.round(r.audioMs / 60000) : (r[metric] as number),
    }));
    return { series, built: buildAreaChart(series) };
  }, [data, metric]);

  const nowIso = new Date().toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const nextRunCountdown = useMemo(() => {
    if (!data?.config.nextRunAt) return null;
    const diff = data.config.nextRunAt - Date.now();
    if (diff <= 0) return 'agora';
    const h = Math.floor(diff / 3_600_000);
    const m = Math.floor((diff % 3_600_000) / 60_000);
    return `${h}h ${m}m`;
  }, [data]);

  return (
    <section>
      <header className="page-h">
        <div>
          <div className="section-mark">Visão geral · {nowIso}</div>
          <h1>
            Painel,
            <br />
            <em>operação.</em>
          </h1>
        </div>
        <p className="desc">
          {loading
            ? 'carregando dados do workspace…'
            : error
              ? `falha: ${error}`
              : data
                ? `${data.stats.groupsActive} grupos monitorados. ${
                    nextRunCountdown ? 'Próximo resumo automático em' : 'Sem cron configurado.'
                  }`
                : ''}
          {!loading && !error && nextRunCountdown && (
            <b style={{ color: 'var(--ink)' }}> {nextRunCountdown}</b>
          )}
        </p>
      </header>

      <Stats data={data} loading={loading} navigate={navigate} />

      <div className="grid-2">
        <div className="panel">
          <div className="panel-h">
            <h3>Atividade dos últimos 7 dias</h3>
            <div className="toolbar">
              <button
                className={`tool-btn ${metric === 'messages' ? 'on' : ''}`}
                onClick={() => setMetric('messages')}
              >
                Mensagens
              </button>
              <button
                className={`tool-btn ${metric === 'summaries' ? 'on' : ''}`}
                onClick={() => setMetric('summaries')}
              >
                Resumos
              </button>
              <button
                className={`tool-btn ${metric === 'audioMs' ? 'on' : ''}`}
                onClick={() => setMetric('audioMs')}
              >
                Áudio (min)
              </button>
            </div>
          </div>
          <ActivityChart
            series={chart.series}
            built={chart.built}
            unit={metric === 'audioMs' ? 'min' : metric === 'messages' ? 'msgs' : 'resumos'}
          />
          <div className="chart-foot">
            {(data?.activity ?? Array.from({ length: 7 }, () => ({ day: '' }))).map((a, i, arr) => (
              <div key={i} className={`cf ${i === arr.length - 1 ? 'on' : ''}`}>
                {a.day ? formatDayShort(a.day) : '—'}
              </div>
            ))}
          </div>
        </div>

        <div className="panel panel-orange">
          <div className="panel-h">
            <h3>Próximos resumos</h3>
            <div className="toolbar">
              <button className="tool-btn on">Hoje</button>
            </div>
          </div>
          <div className="runs">
            {(data?.nextRuns ?? []).slice(0, 4).map((r) => (
              <button
                type="button"
                key={`${r.platform}-${r.groupId}`}
                className="run run-clickable"
                onClick={() =>
                  openManual({ platform: r.platform, groupId: r.groupId, mode: 'run' })
                }
                title="Abrir disparo manual com este grupo pré-selecionado"
              >
                <div className="run-time">
                  {formatTimeHM(r.scheduledAt)}
                  <small>BRT</small>
                </div>
                <div className="run-info">
                  <b title={r.groupName}>{r.groupName || r.groupId}</b>
                  <span>
                    cron · {r.windowHours}h · {r.platform === 'whatsapp' ? 'WhatsApp' : 'Telegram'}
                  </span>
                </div>
                <span className="pf">{r.platform === 'whatsapp' ? 'WPP' : 'TG'}</span>
              </button>
            ))}
            {(!data || data.nextRuns.length === 0) && (
              <button
                type="button"
                className="empty"
                onClick={() => navigate('config')}
                style={{ background: 'transparent', cursor: 'pointer', font: 'inherit', color: 'inherit', width: '100%' }}
              >
                Nenhum grupo configurado.
                <br />
                Clique para abrir <b>Configurações</b> e cadastrar os grupos.
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="grid-2">
        <div className="panel">
          <div className="panel-h">
            <h3>Resumos recentes</h3>
            <div className="toolbar">
              <button className="tool-btn" onClick={load} title="Recarregar">
                ↻ recarregar
              </button>
              <button className="tool-btn" onClick={() => openResumos()} title="Ver histórico completo">
                Ver todos →
              </button>
            </div>
          </div>
          <div className="sum-list">
            {(data?.recentSummaries ?? []).slice(0, 4).map((s, i) => {
              const { title, body } = extractTitle(s.text);
              return (
                <button
                  type="button"
                  key={s.id}
                  className="sum sum-clickable"
                  onClick={() => openResumos(s.groupId)}
                  title="Ver histórico deste grupo"
                >
                  <div className="sum-n">{String(i + 1).padStart(2, '0')}</div>
                  <div className="sum-body">
                    <div className="sum-meta">
                      <span className={`pf ${s.platform === 'whatsapp' ? 'wpp' : 'tg'}`}>
                        {s.platform === 'whatsapp' ? 'WPP' : 'TG'}
                      </span>
                      <span>{s.groupName || s.groupId}</span>
                      <span>·</span>
                      <span>{formatRelative(s.createdAt)}</span>
                      <span>·</span>
                      <span>{s.messageCount} msgs</span>
                    </div>
                    <h4>{title}</h4>
                    <p>{body.length > 240 ? body.slice(0, 240).trim() + '…' : body}</p>
                  </div>
                </button>
              );
            })}
            {(!data || data.recentSummaries.length === 0) && (
              <p style={{ color: 'var(--mute)', fontSize: 13, padding: '20px 0' }}>
                Nenhum resumo gerado ainda. Use o disparo manual abaixo ou aguarde o cron.
              </p>
            )}
          </div>
        </div>

        <div className="panel">
          <div className="panel-h">
            <h3>Status dos serviços</h3>
            <button
              type="button"
              className="pill"
              onClick={() => navigate('integracoes')}
              style={{ cursor: 'pointer', font: 'inherit' }}
              title="Ver detalhes das integrações"
            >
              <span
                className={`pdot ${
                  data?.services.every((s) => s.state === 'ok')
                    ? ''
                    : data?.services.some((s) => s.state === 'off')
                      ? 'off'
                      : 'warn'
                }`}
              />
              {data?.services.every((s) => s.state === 'ok')
                ? 'operacional'
                : data?.services.some((s) => s.state === 'off')
                  ? 'configurar'
                  : 'atenção'}
            </button>
          </div>
          <div className="statuses">
            {(data?.services ?? []).map((s) => (
              <button
                type="button"
                key={s.key}
                className="svc svc-clickable"
                onClick={() => navigate(s.state === 'off' ? 'config' : 'integracoes')}
                title={s.state === 'off' ? 'Configurar este serviço' : 'Ver detalhes'}
              >
                <div className="svc-l">
                  <div
                    className="svc-i"
                    style={{
                      background:
                        s.key === 'evolution'
                          ? 'var(--orange)'
                          : s.key === 'gemini'
                            ? 'var(--orange-2)'
                            : s.key === 'postgres'
                              ? 'var(--orange-3)'
                              : s.key === 'telegram'
                                ? 'var(--ink)'
                                : 'var(--bone)',
                      color:
                        s.key === 'evolution' ||
                        s.key === 'telegram' ||
                        s.key === 'elevenlabs'
                          ? '#fff'
                          : '#000',
                    }}
                  >
                    {s.short}
                  </div>
                  <div>
                    <b>{s.name}</b>
                    <small>{s.detail}</small>
                  </div>
                </div>
                <div className="svc-r">
                  <span className={`pdot ${s.state === 'warn' ? 'warn' : s.state === 'off' ? 'off' : ''}`} />
                  {s.state === 'ok' ? 'ok' : s.state === 'warn' ? 'aviso' : 'configurar'}
                </div>
              </button>
            ))}
            {!data && <p style={{ color: 'var(--mute)', fontSize: 13 }}>carregando…</p>}
          </div>
        </div>
      </div>

      <div ref={manualRef}>
        <ManualTrigger
          windowHoursDefault={data?.config.windowHours ?? 24}
          showToast={showToast}
          onDone={load}
          intent={manualIntent}
        />
      </div>
    </section>
  );
}

function Stats({
  data,
  loading,
  navigate,
}: {
  data: DashboardData | null;
  loading: boolean;
  navigate: (v: View) => void;
}) {
  const s = data?.stats;
  const audio = formatAudioTime(s?.audioMsMonth ?? 0);
  const delta = s?.messages24hDeltaPct ?? 0;
  return (
    <div className="stats">
      <button
        type="button"
        className="stat stat-clickable"
        onClick={() => navigate('mensagens')}
        title="Ver mensagens capturadas"
      >
        <div>
          <div className="stat-l">Mensagens · 24h</div>
          <div className={`stat-arr ${delta < 0 ? 'down' : ''}`}>
            {delta >= 0 ? `+${delta}% ↗` : `${delta}% ↘`}
          </div>
        </div>
        <div>
          <div className="stat-v">{loading ? '—' : formatNumber(s?.messages24h ?? 0)}</div>
          <div className="stat-d">
            <span>vs 24h anteriores</span>
            <b>
              {delta >= 0 ? '+' : ''}
              {delta}%
            </b>
          </div>
        </div>
      </button>
      <button
        type="button"
        className="stat stat-clickable"
        onClick={() => navigate('grupos')}
        title="Ver grupos monitorados"
      >
        <div>
          <div className="stat-l">Grupos ativos</div>
        </div>
        <div>
          <div className="stat-v">{loading ? '—' : (s?.groupsActive ?? 0)}</div>
          <div className="stat-d">
            <span>capacidade</span>
            <b>{s?.groupsCapacity ?? 48}</b>
          </div>
        </div>
      </button>
      <button
        type="button"
        className="stat stat-clickable"
        onClick={() => navigate('resumos')}
        title="Ver histórico de resumos"
      >
        <div>
          <div className="stat-l">Resumos enviados</div>
        </div>
        <div>
          <div className="stat-v">{loading ? '—' : (s?.summariesMonth ?? 0)}</div>
          <div className="stat-d">
            <span>esta semana</span>
            <b>{s?.summariesWeek ?? 0}</b>
          </div>
        </div>
      </button>
      <button
        type="button"
        className="stat stat-clickable"
        onClick={() => navigate('resumos')}
        title="Ver resumos com áudio"
      >
        <div>
          <div className="stat-l">Tempo de áudio</div>
        </div>
        <div>
          <div className="stat-v">
            {loading ? '—' : audio.value}
            {audio.small && <small>{audio.small}</small>}
          </div>
          <div className="stat-d">
            <span>no mês</span>
            <b>
              {s?.summariesMonth
                ? Math.round((s.audioMsMonth / s.summariesMonth) / 1000) + 's/resumo'
                : '—'}
            </b>
          </div>
        </div>
      </button>
    </div>
  );
}

function ActivityChart({
  series,
  built,
  unit,
}: {
  series: { day: string; value: number }[];
  built: ReturnType<typeof buildAreaChart>;
  unit: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const hasData = series.some((s) => s.value > 0);
  if (!series.length || !hasData) {
    return (
      <div
        style={{
          height: 190,
          display: 'grid',
          placeItems: 'center',
          color: 'var(--mute)',
          fontSize: 12.5,
        }}
      >
        sem dados ainda — os pontos aparecem após o primeiro resumo
      </div>
    );
  }

  const W = 720;
  const H = 240;

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    let bestDist = Infinity;
    built.points.forEach((p, i) => {
      const d = Math.abs(p.x - x);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    setHover(best);
  }

  const tip = hover != null ? built.points[hover] : null;
  const tipDay = hover != null ? series[hover]?.day : null;

  return (
    <div ref={wrapRef} className="chart-wrap">
      <svg
        className="chart"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="ar" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FC3B00" stopOpacity=".25" />
            <stop offset="100%" stopColor="#FC3B00" stopOpacity="0" />
          </linearGradient>
        </defs>
        <g stroke="#E8E4DE" strokeDasharray="3 4">
          <line x1="0" y1="60" x2="720" y2="60" />
          <line x1="0" y1="120" x2="720" y2="120" />
          <line x1="0" y1="180" x2="720" y2="180" />
        </g>
        <path d={built.area} fill="url(#ar)" />
        <path
          d={built.line}
          fill="none"
          stroke="#FC3B00"
          strokeWidth="2.4"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {tip && (
          <line
            x1={tip.x}
            y1="0"
            x2={tip.x}
            y2={H - 10}
            stroke="#FC3B00"
            strokeOpacity=".35"
            strokeDasharray="2 4"
          />
        )}
        <g fill="#FC3B00">
          {built.points.map((p, i) => (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r={i === hover ? 6 : i === built.points.length - 1 ? 5 : 3.5}
              stroke={i === hover || i === built.points.length - 1 ? '#fff' : undefined}
              strokeWidth={i === hover || i === built.points.length - 1 ? 2.5 : undefined}
            />
          ))}
        </g>
        {hover == null && built.points.length > 0 && (
          <text
            x={built.points[built.points.length - 1].x}
            y={Math.max(20, built.points[built.points.length - 1].y - 12)}
            fontWeight="700"
            fontSize="13"
            fill="#0A0A0A"
            textAnchor="middle"
          >
            {built.points[built.points.length - 1].value}
          </text>
        )}
      </svg>
      {tip && tipDay && (
        <div
          className="chart-tip"
          style={{
            left: `calc(${(tip.x / W) * 100}% )`,
            top: `${(tip.y / H) * 100}%`,
          }}
        >
          <b>{tip.value}</b> {unit}
          <small>
            {new Date(tipDay + 'T12:00:00Z').toLocaleDateString('pt-BR', {
              weekday: 'short',
              day: '2-digit',
              month: 'short',
            })}
          </small>
        </div>
      )}
    </div>
  );
}

function ManualTrigger({
  windowHoursDefault,
  showToast,
  onDone,
  intent,
}: {
  windowHoursDefault: number;
  showToast: (msg: string, err?: boolean) => void;
  onDone: () => void;
  intent?: ManualIntent;
}) {
  const [platform, setPlatform] = useState<Platform>('whatsapp');
  const [groupId, setGroupId] = useState('');
  const [windowHours, setWindowHours] = useState(windowHoursDefault);
  const [mode, setMode] = useState<'preview' | 'run'>('preview');
  const [source, setSource] = useState<'group' | 'pasted'>('group');
  const [pastedText, setPastedText] = useState('');
  const [loading, setLoading] = useState(false);
  const [lastPreview, setLastPreview] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [groupOptions, setGroupOptions] = useState<{ id: string; label: string }[]>([]);
  const [availableCount, setAvailableCount] = useState<number | null>(null);
  const [countLoading, setCountLoading] = useState(false);
  const flashRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => setWindowHours(windowHoursDefault), [windowHoursDefault]);

  // Carrega grupos cadastrados de acordo com a plataforma.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (platform === 'whatsapp') {
          const r = await fetch('/api/settings', { cache: 'no-store' });
          const cfg = await r.json();
          const groups: string[] = cfg?.evolution?.groups ?? [];
          if (!cancelled) {
            setGroupOptions(groups.map((g) => ({ id: g, label: g })));
          }
        } else {
          const [sRes, cRes] = await Promise.all([
            fetch('/api/settings', { cache: 'no-store' }),
            fetch('/api/telegram/chats', { cache: 'no-store' }).catch(() => null),
          ]);
          const cfg = await sRes.json();
          const ids: number[] = cfg?.telegram?.groups ?? [];
          const titleMap = new Map<number, string>();
          if (cRes && cRes.ok) {
            const data = await cRes.json();
            for (const c of (data?.chats ?? []) as { chatId: number; title: string | null }[]) {
              if (c.title) titleMap.set(c.chatId, c.title);
            }
          }
          if (!cancelled) {
            setGroupOptions(
              ids.map((id) => ({
                id: String(id),
                label: titleMap.get(id) ? `${titleMap.get(id)} (${id})` : String(id),
              })),
            );
          }
        }
      } catch {
        if (!cancelled) setGroupOptions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [platform]);

  // Quando a lista muda, seleciona automaticamente o primeiro se groupId atual nao estiver nela
  useEffect(() => {
    if (!groupOptions.length) return;
    if (!groupOptions.find((g) => g.id === groupId)) {
      setGroupId(groupOptions[0].id);
    }
  }, [groupOptions, groupId]);

  useEffect(() => {
    if (!intent || intent.nonce === 0) return;
    if (intent.platform) setPlatform(intent.platform);
    if (intent.groupId) setGroupId(intent.groupId);
    if (intent.mode) setMode(intent.mode);
    flashRef.current?.classList.add('flash');
    const t = setTimeout(() => flashRef.current?.classList.remove('flash'), 900);
    return () => clearTimeout(t);
  }, [intent?.nonce, intent?.platform, intent?.groupId, intent?.mode]);

  // Busca a contagem de mensagens disponiveis (debounced) sempre que os
  // parametros mudam. Isso evita o submit cair em "mensagens insuficientes"
  // sem o usuario saber de antemao.
  useEffect(() => {
    if (source !== 'group') return;
    if (!groupId.trim() || !windowHours) {
      setAvailableCount(null);
      return;
    }
    let cancelled = false;
    setCountLoading(true);
    const t = setTimeout(async () => {
      try {
        const q = new URLSearchParams({
          platform,
          groupId: groupId.trim(),
          windowHours: String(windowHours),
        });
        const r = await fetch(`/api/summary/count?${q}`, { cache: 'no-store' });
        const data = await r.json().catch(() => ({}));
        if (!cancelled) setAvailableCount(r.ok && data.ok ? Number(data.count) : null);
      } catch {
        if (!cancelled) setAvailableCount(null);
      } finally {
        if (!cancelled) setCountLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [platform, groupId, windowHours, source]);

  async function trigger() {
    setLoading(true);
    setLastPreview(null);
    setLastError(null);
    try {
      let url: string;
      let body: Record<string, unknown>;
      if (source === 'pasted') {
        if (!pastedText.trim()) {
          setLoading(false);
          return showToast('Cole ao menos uma linha de texto', true);
        }
        url = '/api/summary/preview';
        body = { pastedText };
      } else {
        const id = groupId.trim();
        if (!id) {
          setLoading(false);
          return showToast('Selecione um grupo', true);
        }
        url = mode === 'preview' ? '/api/summary/preview' : '/api/summary/run';
        body = { platform, groupId: id, windowHours };
      }
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok && data.ok) {
        const isPreview = source === 'pasted' || mode === 'preview';
        showToast(
          `OK · ${data.messageCount ?? 0} mensagens · ${isPreview ? 'pré-visualizado' : 'enviado'}`,
        );
        if (isPreview && data.text) setLastPreview(data.text);
        onDone();
      } else {
        const reason = data.reason || data.error || `HTTP ${r.status}`;
        setLastError(reason);
        showToast('Falha — detalhes no painel abaixo', true);
      }
    } catch (err: any) {
      setLastError(err?.message ?? String(err));
      showToast('Erro — detalhes no painel abaixo', true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div ref={flashRef} className="panel panel-manual" style={{ marginTop: 22 }}>
      <div className="panel-h">
        <h3>Disparo manual</h3>
        <div className="toolbar">
          <button className={`tool-btn ${mode === 'preview' ? 'on' : ''}`} onClick={() => setMode('preview')}>
            Pré-visualizar
          </button>
          <button className={`tool-btn ${mode === 'run' ? 'on' : ''}`} onClick={() => setMode('run')}>
            Rodar completo
          </button>
        </div>
      </div>
      <p style={{ fontSize: 12.5, color: 'var(--mute)', marginBottom: 14 }}>
        {source === 'pasted'
          ? 'Cole uma conversa (1 mensagem por linha, formato opcional "Nome: texto") para testar o resumo sem depender da captura de mensagens.'
          : mode === 'preview'
            ? 'Gera o texto do resumo sem TTS, sem envio e sem apagar mensagens. Útil enquanto as APIs externas ainda não estão totalmente conectadas.'
            : 'Executa o pipeline completo: resumo (Gemini) + áudio (ElevenLabs) + envio (WhatsApp/Telegram) + persistência.'}
      </p>
      <div
        style={{
          display: 'inline-flex',
          gap: 0,
          marginBottom: 16,
          border: '1px solid var(--hair)',
          borderRadius: 8,
          overflow: 'hidden',
        }}
      >
        <button
          type="button"
          className={`tool-btn ${source === 'group' ? 'on' : ''}`}
          onClick={() => setSource('group')}
          style={{ borderRadius: 0, border: 'none' }}
        >
          Grupo cadastrado
        </button>
        <button
          type="button"
          className={`tool-btn ${source === 'pasted' ? 'on' : ''}`}
          onClick={() => setSource('pasted')}
          style={{ borderRadius: 0, border: 'none' }}
        >
          Colar texto
        </button>
      </div>
      {source === 'pasted' ? (
        <div className="field full">
          <label>Conversa colada</label>
          <textarea
            value={pastedText}
            onChange={(e) => setPastedText(e.target.value)}
            rows={10}
            placeholder={'Ana: bom dia galera\nBruno: alguém vai pra conferência?\nCarla: eu vou sim, te vejo lá\n...'}
            style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13 }}
          />
          <div style={{ fontSize: 12, color: 'var(--mute)', marginTop: 6 }}>
            {pastedText.split('\n').filter((l) => l.trim()).length} linha(s) · modo teste não envia nem persiste
          </div>
          <div style={{ marginTop: 12 }}>
            <button className="btn" onClick={trigger} disabled={loading || !pastedText.trim()}>
              {loading ? 'resumindo…' : 'Resumir texto colado'}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="manual-grid">
            <div className="field">
              <label>Plataforma</label>
              <select value={platform} onChange={(e) => setPlatform(e.target.value as Platform)}>
                <option value="whatsapp">WhatsApp</option>
                <option value="telegram">Telegram</option>
              </select>
            </div>
            <div className="field">
              <label>Grupo</label>
              {groupOptions.length ? (
                <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                  {groupOptions.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.label}
                    </option>
                  ))}
                </select>
              ) : (
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--mute)',
                    padding: '11px 14px',
                    border: '1px dashed var(--hair)',
                    borderRadius: 8,
                    lineHeight: 1.45,
                  }}
                >
                  Nenhum grupo {platform === 'whatsapp' ? 'do WhatsApp' : 'do Telegram'} cadastrado —
                  adicione em <b>Configurações</b> antes de disparar.
                </div>
              )}
            </div>
            <div className="field">
              <label>Janela (horas)</label>
              <input
                type="number"
                min={1}
                value={windowHours}
                onChange={(e) => setWindowHours(Number(e.target.value))}
              />
            </div>
            <div>
              <button
                className="btn"
                onClick={trigger}
                disabled={loading || !groupId.trim() || availableCount === 0}
                title={
                  availableCount === 0
                    ? 'Nenhuma mensagem capturada — use "Colar texto" para testar, ou aguarde o bot receber mensagens'
                    : undefined
                }
              >
                {loading ? 'rodando…' : mode === 'preview' ? 'Pré-visualizar' : 'Rodar agora'}
              </button>
            </div>
          </div>
          {groupId.trim() && (
            <div
              style={{
                marginTop: 12,
                padding: '10px 14px',
                borderRadius: 8,
                fontSize: 12.5,
                background:
                  availableCount === null || countLoading
                    ? 'var(--bone)'
                    : availableCount === 0
                      ? '#fff4f0'
                      : '#f0f9f0',
                border: `1px solid ${
                  availableCount === 0 && !countLoading ? 'var(--orange)' : 'var(--hair)'
                }`,
                color: 'var(--ink-2)',
              }}
            >
              {countLoading ? (
                <span>contando mensagens…</span>
              ) : availableCount === null ? (
                <span style={{ color: 'var(--mute)' }}>sem dados</span>
              ) : availableCount === 0 ? (
                <span>
                  <b style={{ color: 'var(--orange)' }}>Nenhuma mensagem capturada</b> para este grupo
                  na janela de {windowHours}h. Verifique se o bot está no grupo e se as mensagens
                  estão chegando — ou use <b>Colar texto</b> acima para testar o resumo.
                </span>
              ) : (
                <span>
                  <b>{availableCount}</b> mensagem(ns) disponível(is) na janela de {windowHours}h ·
                  pronto para gerar resumo
                </span>
              )}
            </div>
          )}
        </>
      )}
      {lastPreview && (
        <div
          style={{
            marginTop: 18,
            padding: 18,
            background: 'var(--bone)',
            borderRadius: 10,
            fontSize: 13.5,
            lineHeight: 1.55,
            whiteSpace: 'pre-wrap',
            color: 'var(--ink-2)',
          }}
        >
          {lastPreview}
        </div>
      )}
      {lastError && (
        <div
          style={{
            marginTop: 18,
            padding: 16,
            background: '#fff4f0',
            border: '1px solid var(--orange)',
            borderRadius: 10,
            fontSize: 13,
            lineHeight: 1.55,
            color: 'var(--ink)',
          }}
        >
          <div style={{ fontWeight: 700, color: 'var(--orange)', marginBottom: 6 }}>
            Não foi possível gerar o resumo
          </div>
          <div style={{ whiteSpace: 'pre-wrap' }}>{lastError}</div>
        </div>
      )}
    </div>
  );
}

/* -------------------------------- RESUMOS -------------------------------- */

type ResumoItem = DashboardData['recentSummaries'][number];

function Resumos({
  filter,
  query,
}: {
  filter: { groupId?: string; nonce: number };
  query: string;
}) {
  const [data, setData] = useState<ResumoItem[]>([]);
  const [platform, setPlatform] = useState<'all' | 'whatsapp' | 'telegram'>('all');
  const [thisWeek, setThisWeek] = useState(false);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (filter.nonce === 0) return;
    setGroupId(filter.groupId ?? null);
  }, [filter.nonce, filter.groupId]);

  const [playingId, setPlayingId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const cacheRef = useRef<Map<number, string>>(new Map());

  useEffect(() => {
    setLoading(true);
    fetch('/api/summary/list?limit=100', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => setData(j.summaries ?? []))
      .finally(() => setLoading(false));
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      for (const url of cacheRef.current.values()) URL.revokeObjectURL(url);
      cacheRef.current.clear();
    };
  }, []);

  const filtered = useMemo(() => {
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const q = query.trim().toLowerCase();
    return data.filter((s) => {
      if (platform !== 'all' && s.platform !== platform) return false;
      if (thisWeek && s.createdAt < weekAgo) return false;
      if (groupId && s.groupId !== groupId) return false;
      if (q) {
        const hay = `${s.groupName ?? ''} ${s.groupId} ${s.text}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [data, platform, thisWeek, groupId, query]);

  const groups = useMemo(() => {
    const map = new Map<string, { id: string; label: string; count: number }>();
    for (const s of data) {
      const prev = map.get(s.groupId);
      const label = s.groupName || s.groupId;
      if (prev) prev.count += 1;
      else map.set(s.groupId, { id: s.groupId, label, count: 1 });
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count).slice(0, 6);
  }, [data]);

  const counts = useMemo(() => ({
    all: data.length,
    wpp: data.filter((s) => s.platform === 'whatsapp').length,
    tg: data.filter((s) => s.platform === 'telegram').length,
  }), [data]);

  function showFlash(msg: string) {
    setFlash(msg);
    setTimeout(() => setFlash(null), 2200);
  }

  async function fetchAudioUrl(id: number): Promise<string | null> {
    const cached = cacheRef.current.get(id);
    if (cached) return cached;
    setBusyId(id);
    try {
      const r = await fetch('/api/summary/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summaryId: id }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        showFlash('Falha no áudio: ' + (err.error || r.status));
        return null;
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      cacheRef.current.set(id, url);
      return url;
    } catch (err: any) {
      showFlash('Falha no áudio: ' + (err?.message ?? 'erro'));
      return null;
    } finally {
      setBusyId(null);
    }
  }

  async function togglePlay(id: number) {
    if (playingId === id) {
      audioRef.current?.pause();
      setPlayingId(null);
      return;
    }
    if (audioRef.current) {
      audioRef.current.pause();
    }
    const url = await fetchAudioUrl(id);
    if (!url) return;
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.onended = () => setPlayingId((cur) => (cur === id ? null : cur));
    audio.onpause = () => setPlayingId((cur) => (cur === id ? null : cur));
    try {
      await audio.play();
      setPlayingId(id);
    } catch (err: any) {
      showFlash('Falha ao tocar: ' + (err?.message ?? 'erro'));
    }
  }

  async function downloadMp3(s: ResumoItem) {
    const url = await fetchAudioUrl(s.id);
    if (!url) return;
    const safe = (s.groupName || s.groupId).replace(/[^a-z0-9\-_]+/gi, '-').slice(0, 40);
    const a = document.createElement('a');
    a.href = url;
    a.download = `resumo-${safe}-${s.id}.mp3`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    showFlash('Download iniciado');
  }

  async function shareSummary(s: ResumoItem) {
    const payload = {
      title: 'Resumo GrupResumo',
      text: s.text,
    };
    try {
      if (typeof navigator !== 'undefined' && (navigator as any).share) {
        await (navigator as any).share(payload);
        return;
      }
      await navigator.clipboard.writeText(s.text);
      showFlash('Resumo copiado');
    } catch {
      showFlash('Não foi possível compartilhar');
    }
  }

  return (
    <section>
      <header className="page-h">
        <div>
          <div className="section-mark">Histórico</div>
          <h1>
            Resumos,
            <br />
            <em>publicados.</em>
          </h1>
        </div>
        <p className="desc">
          {counts.all} resumos salvos no Postgres. Filtre por plataforma, período ou grupo para
          ouvir o áudio.
        </p>
      </header>
      <div className="panel">
        <div className="panel-h">
          <div className="toolbar">
            <button
              className={`tool-btn ${platform === 'all' && !thisWeek && !groupId ? 'on' : ''}`}
              onClick={() => {
                setPlatform('all');
                setThisWeek(false);
                setGroupId(null);
              }}
            >
              Todos · {counts.all}
            </button>
            <button
              className={`tool-btn ${platform === 'whatsapp' ? 'on' : ''}`}
              onClick={() => setPlatform(platform === 'whatsapp' ? 'all' : 'whatsapp')}
            >
              WhatsApp · {counts.wpp}
            </button>
            <button
              className={`tool-btn ${platform === 'telegram' ? 'on' : ''}`}
              onClick={() => setPlatform(platform === 'telegram' ? 'all' : 'telegram')}
            >
              Telegram · {counts.tg}
            </button>
            <button
              className={`tool-btn ${thisWeek ? 'on' : ''}`}
              onClick={() => setThisWeek((v) => !v)}
            >
              Esta semana
            </button>
            {groups.map((g) => (
              <button
                key={g.id}
                className={`tool-btn ${groupId === g.id ? 'on' : ''}`}
                title={g.id}
                onClick={() => setGroupId(groupId === g.id ? null : g.id)}
              >
                {g.label}
              </button>
            ))}
          </div>
        </div>
        <div className="sum-list">
          {loading && <p style={{ color: 'var(--mute)', fontSize: 13 }}>carregando…</p>}
          {!loading && filtered.length === 0 && (
            <p style={{ color: 'var(--mute)', fontSize: 13, padding: '20px 0' }}>
              Nenhum resumo encontrado.
            </p>
          )}
          {filtered.map((s, i) => {
            const { title, body } = extractTitle(s.text);
            const isPlaying = playingId === s.id;
            const isBusy = busyId === s.id;
            return (
              <div key={s.id} className="sum">
                <div className="sum-n">{String(i + 1).padStart(2, '0')}</div>
                <div className="sum-body">
                  <div className="sum-meta">
                    <span className={`pf ${s.platform === 'whatsapp' ? 'wpp' : 'tg'}`}>
                      {s.platform === 'whatsapp' ? 'WPP' : 'TG'}
                    </span>
                    <span>{s.groupName || s.groupId}</span>
                    <span>·</span>
                    <span>{formatRelative(s.createdAt)}</span>
                    <span>·</span>
                    <span>{s.messageCount} msgs</span>
                  </div>
                  <h4>{title}</h4>
                  <p>{body}</p>
                </div>
                <div className="sum-act">
                  <button
                    className={`ico-btn ${isPlaying ? 'play' : ''}`}
                    onClick={() => togglePlay(s.id)}
                    disabled={isBusy}
                    title={isPlaying ? 'Pausar' : 'Tocar áudio'}
                    aria-label={isPlaying ? 'Pausar' : 'Tocar'}
                  >
                    {isBusy ? (
                      <svg viewBox="0 0 24 24">
                        <circle
                          cx="12"
                          cy="12"
                          r="9"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeDasharray="14 28"
                        />
                      </svg>
                    ) : isPlaying ? (
                      <svg viewBox="0 0 24 24">
                        <rect x="6" y="5" width="4" height="14" fill="currentColor" />
                        <rect x="14" y="5" width="4" height="14" fill="currentColor" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24">
                        <polygon points="5 3 19 12 5 21 5 3" fill="currentColor" />
                      </svg>
                    )}
                  </button>
                  <button
                    className="ico-btn"
                    onClick={() => downloadMp3(s)}
                    disabled={isBusy}
                    title="Baixar MP3"
                    aria-label="Baixar"
                  >
                    <svg viewBox="0 0 24 24">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
                    </svg>
                  </button>
                  <button
                    className="ico-btn"
                    onClick={() => shareSummary(s)}
                    title="Compartilhar"
                    aria-label="Compartilhar"
                  >
                    <svg viewBox="0 0 24 24">
                      <circle cx="18" cy="5" r="3" />
                      <circle cx="6" cy="12" r="3" />
                      <circle cx="18" cy="19" r="3" />
                      <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
                    </svg>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {flash && (
        <div
          style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            background: 'var(--ink)',
            color: '#fff',
            padding: '10px 18px',
            borderRadius: 999,
            fontSize: 13,
            fontWeight: 500,
            boxShadow: '0 6px 24px rgba(0,0,0,.2)',
            zIndex: 50,
          }}
        >
          {flash}
        </div>
      )}
    </section>
  );
}

/* ------------------------------ MENSAGENS ------------------------------ */

function Mensagens({ query }: { query: string }) {
  const [data, setData] = useState<DashboardData['recentMessages']>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = () => {
      fetch('/api/dashboard', { cache: 'no-store' })
        .then((r) => r.json())
        .then((j: DashboardData) => setData(j.recentMessages ?? []))
        .finally(() => setLoading(false));
    };
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return data;
    return data.filter((m) => {
      const hay = `${m.senderName} ${m.content} ${m.groupName ?? ''} ${m.groupId}`.toLowerCase();
      return hay.includes(q);
    });
  }, [data, query]);

  return (
    <section>
      <header className="page-h">
        <div>
          <div className="section-mark">Stream em tempo real</div>
          <h1>
            Mensagens,
            <br />
            <em>capturadas.</em>
          </h1>
        </div>
        <p className="desc">
          {query.trim()
            ? `${filtered.length} de ${data.length} mensagem(ns) para "${query.trim()}".`
            : 'Últimas mensagens recebidas. Atualiza a cada 15s.'}
        </p>
      </header>
      <div className="panel">
        {loading && <p style={{ color: 'var(--mute)', fontSize: 13 }}>carregando…</p>}
        {!loading && filtered.length === 0 && (
          <p style={{ color: 'var(--mute)', fontSize: 13 }}>
            {data.length === 0
              ? 'Nenhuma mensagem capturada ainda. Assim que os webhooks forem conectados, as mensagens aparecem aqui.'
              : 'Nenhuma mensagem corresponde à busca.'}
          </p>
        )}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {filtered.map((m) => (
            <div
              key={m.id}
              style={{
                display: 'grid',
                gridTemplateColumns: 'auto 1fr auto',
                gap: 14,
                padding: '16px 0',
                borderBottom: '1px dashed var(--hair)',
                alignItems: 'flex-start',
              }}
            >
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  background: m.platform === 'whatsapp' ? '#FFE9DD' : 'var(--ink)',
                  color: m.platform === 'whatsapp' ? 'var(--orange)' : '#fff',
                  display: 'grid',
                  placeItems: 'center',
                  fontWeight: 600,
                  fontSize: 12.5,
                }}
              >
                {m.senderName.slice(0, 2).toUpperCase()}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', marginBottom: 4, flexWrap: 'wrap' }}>
                  <b style={{ fontSize: 13.5 }}>{m.senderName}</b>
                  <span style={{ fontSize: 11, color: 'var(--mute)' }}>
                    {(m.groupName || m.groupId) +
                      ' · ' +
                      (m.platform === 'whatsapp' ? 'WhatsApp' : 'Telegram')}
                  </span>
                </div>
                <p style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.5 }}>{m.content}</p>
              </div>
              <span style={{ fontSize: 11, color: 'var(--mute-2)' }}>{formatTimeHM(m.timestamp)}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------- GRUPOS ------------------------------- */

function Grupos({
  openManual,
}: {
  openManual: (intent?: { platform?: Platform; groupId?: string; mode?: 'preview' | 'run' }) => void;
}) {
  const [data, setData] = useState<DashboardData | null>(null);
  useEffect(() => {
    fetch('/api/dashboard', { cache: 'no-store' })
      .then((r) => r.json())
      .then(setData);
  }, []);

  const groups = useMemo(() => {
    if (!data) return [] as { platform: Platform; id: string }[];
    return data.nextRuns.map((r) => ({ platform: r.platform, id: r.groupId }));
  }, [data]);

  return (
    <section>
      <header className="page-h">
        <div>
          <div className="section-mark">{groups.length} grupos configurados</div>
          <h1>
            Grupos,
            <br />
            <em>monitorados.</em>
          </h1>
        </div>
        <p className="desc">
          Clique em um grupo para abrir o disparo manual com ele pré-selecionado.
        </p>
      </header>
      <div className="grid-3">
        {groups.map((g) => (
          <button
            type="button"
            key={`${g.platform}-${g.id}`}
            className="panel group-card"
            onClick={() => openManual({ platform: g.platform, groupId: g.id, mode: 'preview' })}
          >
            <div className="panel-h" style={{ marginBottom: 10 }}>
              <h3 style={{ fontSize: 14, wordBreak: 'break-all' }}>{g.id}</h3>
              <span
                className="pill"
                style={{
                  background: g.platform === 'whatsapp' ? 'var(--orange)' : 'var(--ink)',
                  color: '#fff',
                  border: 0,
                }}
              >
                {g.platform === 'whatsapp' ? 'WPP' : 'TG'}
              </span>
            </div>
            <p style={{ fontSize: 12, color: 'var(--mute)' }}>
              cron diário · janela {data?.config.windowHours}h
            </p>
            <p style={{ fontSize: 11, color: 'var(--orange)', marginTop: 8, fontWeight: 600 }}>
              Disparar manualmente →
            </p>
          </button>
        ))}
        {groups.length === 0 && (
          <div className="panel" style={{ gridColumn: '1 / -1' }}>
            <p style={{ color: 'var(--mute)', fontSize: 13 }}>
              Nenhum grupo cadastrado. Vá em <b>Configurações</b> para adicionar os IDs dos grupos.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

/* ---------------------------- INTEGRACOES ---------------------------- */

function Integracoes({ navigate }: { navigate: (v: View) => void }) {
  const [data, setData] = useState<DashboardData | null>(null);
  useEffect(() => {
    fetch('/api/dashboard', { cache: 'no-store' })
      .then((r) => r.json())
      .then(setData);
  }, []);

  return (
    <section>
      <header className="page-h">
        <div>
          <div className="section-mark">{data?.services.length ?? 0} serviços</div>
          <h1>
            Integrações,
            <br />
            <em>e provedores.</em>
          </h1>
        </div>
        <p className="desc">Clique em um serviço para configurar suas credenciais.</p>
      </header>
      <div className="grid-3">
        {(data?.services ?? []).map((s) => (
          <button
            type="button"
            key={s.key}
            className="panel group-card"
            onClick={() => navigate('config')}
          >
            <div className="panel-h">
              <h3 style={{ fontSize: 15 }}>{s.name}</h3>
              <span className="pill">
                <span className={`pdot ${s.state === 'warn' ? 'warn' : s.state === 'off' ? 'off' : ''}`} />
                {s.state === 'ok' ? 'online' : s.state === 'warn' ? 'aviso' : 'não configurado'}
              </span>
            </div>
            <p style={{ fontSize: 12, color: 'var(--mute)' }}>{s.detail}</p>
            <p style={{ fontSize: 11, color: 'var(--orange)', marginTop: 10, fontWeight: 600 }}>
              Abrir configurações →
            </p>
          </button>
        ))}
      </div>
    </section>
  );
}

/* ---------------------------- CONFIGURAÇÕES ---------------------------- */

interface TgGroupCheck {
  chatId: number;
  ok: boolean;
  title?: string;
  type?: string;
  memberCount?: number;
  botStatus?: string;
  canSendMessages?: boolean;
  error?: string;
}

interface TgCheckResult {
  ok: boolean;
  bot?: { id: number; username: string; name: string } | null;
  groups?: TgGroupCheck[];
  error?: string;
}

interface DiscoveredChat {
  chatId: number;
  title: string | null;
  type: string | null;
  memberCount?: number;
  messageCount?: number;
  active: boolean;
  source: 'db' | 'getUpdates' | 'both';
  lastSeen?: number;
}

interface DiscoverResult {
  ok: boolean;
  note?: string | null;
  webhook?: {
    url: string;
    pendingCount: number;
    lastErrorAt?: number;
    lastErrorMessage?: string;
    hasError: boolean;
  } | null;
  chats?: DiscoveredChat[];
  error?: string;
}

function Configuracoes({ showToast }: { showToast: (msg: string, err?: boolean) => void }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [status, setStatus] = useState('carregando…');
  const [tgCheck, setTgCheck] = useState<TgCheckResult | null>(null);
  const [tgChecking, setTgChecking] = useState(false);
  const [tgDiscover, setTgDiscover] = useState<DiscoverResult | null>(null);
  const [tgDiscovering, setTgDiscovering] = useState(false);
  const [tgSelected, setTgSelected] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    setStatus('carregando…');
    const r = await fetch('/api/settings', { cache: 'no-store' });
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
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!formRef.current) return;
    const patch: any = {};
    for (const el of Array.from(formRef.current.elements) as HTMLInputElement[]) {
      if (!el.name) continue;
      let value: any = el.value;
      if (el.name.endsWith('.groups')) {
        value = value.split(',').map((s: string) => s.trim()).filter(Boolean);
        if (el.name === 'telegram.groups') value = value.map(Number).filter((n: number) => !Number.isNaN(n));
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

  async function setupTelegramWebhook() {
    showToast('registrando webhook do Telegram…');
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const r = await fetch('/api/telegram/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: origin }),
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok && data.ok) {
      showToast(`Webhook OK: ${data.webhook}`);
      discoverTelegramChats().catch(() => {});
    } else {
      showToast('Falha: ' + (data.error || r.status), true);
    }
  }

  async function discoverTelegramChats() {
    setTgDiscovering(true);
    try {
      const r = await fetch('/api/telegram/chats', { cache: 'no-store' });
      const data: DiscoverResult = await r.json();
      setTgDiscover(data);
      if (data.chats) {
        setTgSelected(new Set(data.chats.filter((c) => c.active).map((c) => c.chatId)));
      }
      if (!r.ok) showToast(data.error || 'falha na descoberta', true);
      else if (!data.chats?.length) showToast('nenhum grupo descoberto ainda', true);
      else showToast(`${data.chats.length} grupo(s) encontrado(s)`);
    } catch (err: any) {
      setTgDiscover({ ok: false, error: err?.message ?? 'erro' });
      showToast('erro: ' + (err?.message ?? 'falha'), true);
    } finally {
      setTgDiscovering(false);
    }
  }

  function toggleTgChat(chatId: number) {
    setTgSelected((prev) => {
      const next = new Set(prev);
      if (next.has(chatId)) next.delete(chatId);
      else next.add(chatId);
      return next;
    });
  }

  async function saveSelectedTgChats() {
    const groups = Array.from(tgSelected);
    const r = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegram: { groups } }),
    });
    if (r.ok) {
      showToast(`${groups.length} grupo(s) salvos`);
      load();
    } else {
      const err = await r.json().catch(() => ({}));
      showToast('Erro: ' + (err.error || r.status), true);
    }
  }

  async function verifyTelegramGroups() {
    setTgChecking(true);
    setTgCheck(null);
    try {
      const r = await fetch('/api/telegram/groups', { cache: 'no-store' });
      const data: TgCheckResult = await r.json();
      setTgCheck(data);
      if (!r.ok) showToast(data.error || 'falha na verificação', true);
      else if (data.ok) showToast(`✓ bot @${data.bot?.username} verificado`);
      else showToast('alguns grupos têm problemas — veja abaixo', true);
    } catch (err: any) {
      setTgCheck({ ok: false, error: err?.message ?? 'erro' });
      showToast('erro: ' + (err?.message ?? 'falha'), true);
    } finally {
      setTgChecking(false);
    }
  }

  return (
    <section>
      <header className="page-h">
        <div>
          <div className="section-mark">Workspace</div>
          <h1>
            Configurações,
            <br />
            <em>do sistema.</em>
          </h1>
        </div>
        <p className="desc">
          {status} · credenciais salvas em Postgres com mascaramento. Campos vazios mantêm o valor atual.
        </p>
      </header>

      <form ref={formRef} onSubmit={onSubmit}>
        <div className="panel">
          <div className="form-grid">
            <div className="lbl">
              <h4>WhatsApp</h4>
              <p>Conexão com Evolution API e grupos a monitorar.</p>
            </div>
            <div className="fields">
              <div className="field">
                <label>URL da Evolution</label>
                <input name="evolution.url" placeholder="https://sua-evolution.com" />
              </div>
              <div className="field">
                <label>Instância</label>
                <input name="evolution.instance" placeholder="nome_da_instancia" />
              </div>
              <div className="field">
                <label>API Key</label>
                <input name="evolution.apiKey" type="password" placeholder="••••••••" />
              </div>
              <div className="field full">
                <label>Grupos (IDs separados por vírgula)</label>
                <textarea name="evolution.groups" placeholder="1203630xxxxx@g.us, ..." />
              </div>
            </div>
          </div>

          <div className="form-grid">
            <div className="lbl">
              <h4>Telegram</h4>
              <p>Bot conectado por webhook. Use o botão abaixo para registrar.</p>
            </div>
            <div className="fields">
              <div className="field">
                <label>Bot Token</label>
                <input name="telegram.token" type="password" placeholder="••••••••" />
              </div>
              <div className="field">
                <label>&nbsp;</label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn"
                    onClick={discoverTelegramChats}
                    disabled={tgDiscovering}
                  >
                    {tgDiscovering ? 'descobrindo…' : 'Descobrir grupos'}
                  </button>
                  <button type="button" className="btn btn-g" onClick={setupTelegramWebhook}>
                    Registrar webhook
                  </button>
                  <button
                    type="button"
                    className="btn btn-g"
                    onClick={verifyTelegramGroups}
                    disabled={tgChecking}
                  >
                    {tgChecking ? 'verificando…' : 'Verificar grupos'}
                  </button>
                </div>
              </div>
              {tgDiscover && (
                <div className="field full">
                  <div className="tg-discover">
                    <div className="tg-discover-h">
                      <b>Grupos descobertos</b>
                      <span>
                        {tgDiscover.chats?.length ?? 0} encontrado(s) · selecione para monitorar
                      </span>
                    </div>
                    {tgDiscover.webhook && (
                      <div className={`tg-webhook-info ${tgDiscover.webhook.hasError ? 'err' : ''}`}>
                        <div className="tg-webhook-row">
                          <span className="tg-webhook-k">webhook</span>
                          <code className="tg-webhook-v">{tgDiscover.webhook.url}</code>
                        </div>
                        <div className="tg-webhook-row">
                          <span className="tg-webhook-k">pendentes</span>
                          <b>{tgDiscover.webhook.pendingCount}</b>
                        </div>
                        {tgDiscover.webhook.hasError && (
                          <>
                            <div className="tg-webhook-row">
                              <span className="tg-webhook-k">último erro</span>
                              <span style={{ color: 'var(--orange)', fontWeight: 600 }}>
                                {tgDiscover.webhook.lastErrorMessage}
                              </span>
                            </div>
                            {tgDiscover.webhook.lastErrorAt && (
                              <div className="tg-webhook-row">
                                <span className="tg-webhook-k">em</span>
                                <span>
                                  {new Date(tgDiscover.webhook.lastErrorAt).toLocaleString('pt-BR')}
                                </span>
                              </div>
                            )}
                            <div className="tg-webhook-hint">
                              O Telegram não está conseguindo entregar as mensagens no app. Clique em{' '}
                              <b>Registrar webhook</b> novamente para reapontar para a URL de produção
                              atual.
                            </div>
                          </>
                        )}
                      </div>
                    )}
                    {tgDiscover.note && !tgDiscover.webhook?.hasError && (
                      <div className="tg-discover-note">{tgDiscover.note}</div>
                    )}
                    {tgDiscover.error && <div className="tg-check-err">{tgDiscover.error}</div>}
                    {!tgDiscover.chats?.length && !tgDiscover.error && (
                      <div className="tg-discover-empty">
                        <p>Nenhum grupo encontrado ainda.</p>
                        <ol>
                          <li>Abra o Telegram e adicione seu bot ao grupo</li>
                          <li>Envie qualquer mensagem no grupo (ou <code>/start</code>)</li>
                          <li>Volte aqui e clique em <b>Descobrir grupos</b> novamente</li>
                        </ol>
                      </div>
                    )}
                    {(tgDiscover.chats ?? []).map((c) => {
                      const sel = tgSelected.has(c.chatId);
                      return (
                        <label
                          key={c.chatId}
                          className={`tg-discover-row ${sel ? 'on' : ''}`}
                          onClick={(e) => {
                            e.preventDefault();
                            toggleTgChat(c.chatId);
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={sel}
                            readOnly
                            tabIndex={-1}
                            style={{ pointerEvents: 'none' }}
                          />
                          <div className="tg-discover-body">
                            <div className="tg-discover-title">
                              <b>{c.title ?? `chat ${c.chatId}`}</b>
                              {c.type && <span className="tg-check-tag">{c.type}</span>}
                              {c.active && <span className="tg-discover-active">ativo</span>}
                            </div>
                            <div className="tg-check-meta">
                              <span>id: {c.chatId}</span>
                              {c.memberCount != null && <span>· {c.memberCount} membros</span>}
                              {c.messageCount != null && (
                                <span
                                  style={{
                                    color: c.messageCount > 0 ? 'var(--ok)' : 'var(--orange)',
                                    fontWeight: 600,
                                  }}
                                >
                                  · {c.messageCount} msg(s) capturadas
                                </span>
                              )}
                              {c.lastSeen && (
                                <span>
                                  · última msg:{' '}
                                  {new Date(c.lastSeen).toLocaleString('pt-BR', {
                                    dateStyle: 'short',
                                    timeStyle: 'short',
                                  })}
                                </span>
                              )}
                            </div>
                          </div>
                        </label>
                      );
                    })}
                    {tgDiscover.chats && tgDiscover.chats.length > 0 && (
                      <div className="tg-discover-foot">
                        <span>
                          <b>{tgSelected.size}</b> selecionado(s)
                        </span>
                        <button type="button" className="btn" onClick={saveSelectedTgChats}>
                          Salvar seleção
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
              <div className="field full">
                <label>Chat IDs (números separados por vírgula)</label>
                <textarea name="telegram.groups" placeholder="-1001234567890, ..." />
              </div>
              {tgCheck && (
                <div className="field full">
                  <div className="tg-check">
                    {tgCheck.bot && (
                      <div className="tg-check-bot">
                        <b>Bot:</b> @{tgCheck.bot.username} ({tgCheck.bot.name}) · id {tgCheck.bot.id}
                      </div>
                    )}
                    {tgCheck.error && <div className="tg-check-err">{tgCheck.error}</div>}
                    {(tgCheck.groups ?? []).map((g) => (
                      <div key={g.chatId} className={`tg-check-row ${g.ok && g.canSendMessages ? 'ok' : 'err'}`}>
                        <div className="tg-check-icon">{g.ok && g.canSendMessages ? '✓' : '✕'}</div>
                        <div className="tg-check-body">
                          <div className="tg-check-title">
                            <b>{g.title ?? g.chatId}</b>
                            {g.type && <span className="tg-check-tag">{g.type}</span>}
                          </div>
                          <div className="tg-check-meta">
                            <span>chat_id: {g.chatId}</span>
                            {g.memberCount != null && <span>· {g.memberCount} membros</span>}
                            {g.botStatus && (
                              <span>
                                · bot:{' '}
                                <b style={{ color: g.botStatus === 'administrator' ? 'var(--orange)' : 'var(--ink)' }}>
                                  {g.botStatus}
                                </b>
                              </span>
                            )}
                          </div>
                          {g.error && <div className="tg-check-err-detail">{g.error}</div>}
                        </div>
                      </div>
                    ))}
                    {tgCheck.groups?.length === 0 && (
                      <div className="tg-check-empty">Nenhum chat ID cadastrado.</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="form-grid">
            <div className="lbl">
              <h4>IA · Resumo</h4>
              <p>
                Google Gemini usado para gerar o resumo em PT-BR. Pegue sua API key em{' '}
                <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" style={{ color: 'var(--orange)' }}>
                  aistudio.google.com/apikey
                </a>
                .
              </p>
              <p style={{ fontSize: 11, color: 'var(--mute)', marginTop: 8, lineHeight: 1.5 }}>
                <b>Free tier:</b> 20 req/dia/modelo. Se estourar, troque para{' '}
                <code>gemini-2.5-flash-lite</code> (cota maior) ou ative billing no projeto Google Cloud.
              </p>
            </div>
            <div className="fields">
              <div className="field">
                <label>API Key</label>
                <input name="gemini.apiKey" type="password" placeholder="AIza••••••••" />
              </div>
              <div className="field">
                <label>Modelo</label>
                <input name="gemini.model" defaultValue="gemini-2.5-flash" />
              </div>
            </div>
          </div>

          <div className="form-grid">
            <div className="lbl">
              <h4>TTS · Áudio</h4>
              <p>Configuração da voz e modelo do ElevenLabs.</p>
            </div>
            <div className="fields">
              <div className="field">
                <label>API Key</label>
                <input name="elevenlabs.apiKey" type="password" placeholder="••••••••" />
              </div>
              <div className="field">
                <label>Voice ID</label>
                <input name="elevenlabs.voiceId" />
              </div>
              <div className="field">
                <label>Modelo</label>
                <input name="elevenlabs.model" defaultValue="eleven_multilingual_v2" />
              </div>
              <div className="field">
                <label>Janela (h)</label>
                <input name="scheduler.windowHours" type="number" min={1} defaultValue={24} />
              </div>
            </div>
          </div>

          <div className="form-grid">
            <div className="lbl">
              <h4>Ações</h4>
              <p>Salve e recarregue para aplicar as mudanças.</p>
            </div>
            <div className="fields">
              <div className="field full" style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-g" onClick={load}>
                  Recarregar
                </button>
                <button type="submit" className="btn">
                  Salvar
                </button>
              </div>
            </div>
          </div>
        </div>
      </form>
    </section>
  );
}

/* --------------------------------- LOGS --------------------------------- */

type LogLevel = 'info' | 'warn' | 'err';
type LogEntry = { ts: number; level: LogLevel; tag: string; message: string };

function Logs({
  query,
  health,
  healthDetail,
}: {
  query: string;
  health: HealthState;
  healthDetail: string;
}) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [levelFilter, setLevelFilter] = useState<'all' | LogLevel>('all');

  const load = useCallback(async () => {
    setLoading(true);
    const out: LogEntry[] = [];
    out.push({
      ts: Date.now(),
      level: health === 'ok' ? 'info' : health === 'warn' ? 'warn' : 'err',
      tag: 'health',
      message: `healthcheck · ${healthDetail}`,
    });
    try {
      const [dashR, diagR] = await Promise.all([
        fetch('/api/dashboard', { cache: 'no-store' }),
        fetch('/api/diagnostics', { cache: 'no-store' }),
      ]);
      const dash = await dashR.json().catch(() => ({}));
      const diag = await diagR.json().catch(() => ({}));
      if (Array.isArray(diag?.checks)) {
        for (const c of diag.checks) {
          out.push({
            ts: Date.now(),
            level: c.ok ? 'info' : c.skipped ? 'warn' : 'err',
            tag: `service/${c.name}`,
            message: `${c.ok ? 'ok' : c.skipped ? 'skipped' : 'falha'} · ${c.detail ?? ''}`,
          });
        }
      }
      if (Array.isArray(dash?.recentSummaries)) {
        for (const s of dash.recentSummaries) {
          out.push({
            ts: s.createdAt,
            level: 'info',
            tag: `summary/${s.platform}`,
            message: `resumo#${s.id} · ${s.groupName ?? s.groupId} · ${s.messageCount} msgs · ${Math.round((s.audioMs ?? 0) / 1000)}s áudio`,
          });
        }
      }
      if (Array.isArray(dash?.recentMessages)) {
        for (const m of dash.recentMessages.slice(0, 30)) {
          out.push({
            ts: m.timestamp,
            level: 'info',
            tag: `msg/${m.platform}`,
            message: `${m.senderName} @ ${m.groupName ?? m.groupId} · ${String(m.content).slice(0, 120)}`,
          });
        }
      }
      if (Array.isArray(dash?.nextRuns)) {
        for (const r of dash.nextRuns.slice(0, 4)) {
          out.push({
            ts: r.scheduledAt,
            level: 'info',
            tag: `schedule/${r.platform}`,
            message: `próximo: ${r.groupName ?? r.groupId} · janela ${r.windowHours}h`,
          });
        }
      }
    } catch (err: any) {
      out.push({
        ts: Date.now(),
        level: 'err',
        tag: 'logs',
        message: `erro coletando: ${err?.message ?? err}`,
      });
    }
    out.sort((a, b) => b.ts - a.ts);
    setEntries(out);
    setLoading(false);
  }, [health, healthDetail]);

  useEffect(() => {
    load();
    const t = setInterval(load, 20_000);
    return () => clearInterval(t);
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (levelFilter !== 'all' && e.level !== levelFilter) return false;
      if (q && !`${e.tag} ${e.message}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [entries, levelFilter, query]);

  async function copyAll() {
    const text = filtered
      .map((e) => `[${new Date(e.ts).toISOString()}] ${e.level.toUpperCase()} ${e.tag} — ${e.message}`)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
    } catch {}
  }

  return (
    <section>
      <header className="page-h">
        <div>
          <div className="section-mark">Stream técnico</div>
          <h1>
            Logs,
            <br />
            <em>do pipeline.</em>
          </h1>
        </div>
        <p className="desc">
          Feed agregado de mensagens, resumos, cron e diagnósticos. Atualiza a cada 20s.
        </p>
      </header>
      <div className="panel">
        <div className="panel-h">
          <h3>{filtered.length} entrada(s)</h3>
          <div className="toolbar">
            <button
              className={`tool-btn ${levelFilter === 'all' ? 'on' : ''}`}
              onClick={() => setLevelFilter('all')}
            >
              Todos
            </button>
            <button
              className={`tool-btn ${levelFilter === 'info' ? 'on' : ''}`}
              onClick={() => setLevelFilter('info')}
            >
              Info
            </button>
            <button
              className={`tool-btn ${levelFilter === 'warn' ? 'on' : ''}`}
              onClick={() => setLevelFilter('warn')}
            >
              Aviso
            </button>
            <button
              className={`tool-btn ${levelFilter === 'err' ? 'on' : ''}`}
              onClick={() => setLevelFilter('err')}
            >
              Erro
            </button>
            <button className="tool-btn" onClick={load} title="Recarregar">
              ↻
            </button>
            <button className="tool-btn" onClick={copyAll} title="Copiar para a área de transferência">
              Copiar
            </button>
          </div>
        </div>
        {loading && entries.length === 0 && (
          <p style={{ color: 'var(--mute)', fontSize: 13 }}>carregando feed…</p>
        )}
        {!loading && filtered.length === 0 && (
          <p style={{ color: 'var(--mute)', fontSize: 13 }}>
            Sem entradas para o filtro atual.
          </p>
        )}
        <div className="logs">
          {filtered.map((e, i) => (
            <div key={i} className={`log-row lvl-${e.level}`}>
              <span className="log-ts">{new Date(e.ts).toLocaleTimeString('pt-BR')}</span>
              <span className={`log-lvl lvl-${e.level}`}>{e.level.toUpperCase()}</span>
              <span className="log-tag">{e.tag}</span>
              <span className="log-msg">{e.message}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
