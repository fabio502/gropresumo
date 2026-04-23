import { NextRequest, NextResponse } from 'next/server';
import { deleteTelegramWebhook, setTelegramWebhook } from '@/src/services/telegram';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Vercel preview deployments ficam atras de Deployment Protection (401),
 * entao o Telegram nunca consegue entregar updates neles. Identificamos
 * pelo sufixo "-<hash>-<team>.vercel.app".
 */
const PREVIEW_HOST_RE = /-[a-z0-9]{7,}-[^.]+\.vercel\.app$/i;

function isPreviewHost(host: string): boolean {
  return PREVIEW_HOST_RE.test(host);
}

function hostFromRequest(req: NextRequest): string | null {
  const forwardedHost = req.headers.get('x-forwarded-host');
  const host = forwardedHost || req.headers.get('host');
  if (!host) return null;
  const proto = req.headers.get('x-forwarded-proto') || 'https';
  return `${proto}://${host}`;
}

/**
 * Helper para registrar/remover o webhook do Telegram.
 * - POST { url } registra o webhook (usa APP_URL+/api/telegram quando url ausente)
 * - DELETE remove o webhook
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));

  // Ordem de prioridade para resolver a URL publica:
  // 1. body.url (override explicito do cliente — normalmente window.location.origin)
  // 2. APP_URL (env var manual)
  // 3. VERCEL_PROJECT_PRODUCTION_URL (estavel, aponta pro dominio prod)
  // 4. Host do proprio request (pega dominio customizado se houver)
  // 5. VERCEL_URL (ultimo recurso — muda a cada deploy e pode ser preview)
  const reqHost = hostFromRequest(req);
  const candidates = [
    body.url,
    process.env.APP_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : null,
    reqHost,
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null,
  ].filter((x): x is string => typeof x === 'string' && x.length > 0);

  const base = candidates.find((u) => {
    try {
      return !isPreviewHost(new URL(u).host);
    } catch {
      return false;
    }
  });

  if (!base) {
    const hosts = candidates.map((c) => {
      try {
        return new URL(c).host;
      } catch {
        return c;
      }
    });
    return NextResponse.json(
      {
        ok: false,
        error:
          'todas as URLs candidatas sao de preview deployment (protegidas por auth). ' +
          'Defina APP_URL com o dominio de producao ou acesse o painel pela URL estavel. ' +
          `Candidatos: ${hosts.join(', ') || '(nenhum)'}`,
      },
      { status: 400 },
    );
  }

  const target = base.endsWith('/api/telegram') ? base : `${base.replace(/\/$/, '')}/api/telegram`;
  try {
    await setTelegramWebhook(target);
    return NextResponse.json({ ok: true, webhook: target });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? 'erro' }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    await deleteTelegramWebhook();
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? 'erro' }, { status: 500 });
  }
}
