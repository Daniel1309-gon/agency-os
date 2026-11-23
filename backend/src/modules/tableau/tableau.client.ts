import { Injectable } from '@nestjs/common';
import { ConfigService } from '../../config/config.service.js';

/** Hard cap on a downloaded view: the discovery run saw ~370 KB for 1,528 rows. */
export const MAX_VIEW_BYTES = 50 * 1024 * 1024;
/**
 * Tableau Cloud documents a 120 min session for REST sign-in (another page says 240).
 * The session is renewed well before the shorter one ends.
 */
const SESSION_TTL_MS = 100 * 60_000;
const REQUEST_TIMEOUT_MS = 120_000;
const MAX_RATE_LIMIT_RETRIES = 3;

export class TableauNotConfiguredError extends Error {}

interface Session {
  token: string;
  siteId: string;
  expiresAt: number;
}

export interface ViewDownload {
  body: string;
  contentType: string;
  siteId: string;
}

type Sleep = (ms: number) => Promise<void>;
const defaultSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * REST client for Tableau Cloud (decision #9). Only the worker uses it.
 *
 * - Signs in with a PAT at `/api/{version}/auth/signin` and caches the session.
 *   Concurrent callers share one sign-in, because a second sign-in with the same
 *   PAT ends the first session.
 * - Sends no `Accept` header on view data: `Accept: text/csv` returns 406.
 * - On 401 it signs in again once. It never retries 401 in a loop.
 * - On 429 it backs off (Retry-After, or 2/4/8 s) up to three times.
 */
@Injectable()
export class TableauClient {
  private session?: Session;
  private signingIn?: Promise<Session>;
  private sleep: Sleep = defaultSleep;

  constructor(private readonly config: ConfigService) {}

  /** Test seam: avoids real waits on 429 backoff. */
  useSleep(sleep: Sleep): void {
    this.sleep = sleep;
  }

  siteContentUrl(): string {
    return this.config.get('TABLEAU_SITE_CONTENT_URL');
  }

  isConfigured(): boolean {
    return Boolean(this.config.get('TABLEAU_API_BASE_URL') && this.config.get('TABLEAU_PAT_NAME') && this.config.get('TABLEAU_PAT_SECRET'));
  }

  /** Summary-level CSV of a view (Query View Data). `viewId` is the view LUID. */
  async downloadViewData(viewId: string): Promise<ViewDownload> {
    let session = await this.currentSession();
    let response = await this.getWithBackoff(this.url(`/sites/${encodeURIComponent(session.siteId)}/views/${encodeURIComponent(viewId)}/data`, { maxAge: '1' }), session.token);
    if (response.status === 401) {
      await response.body?.cancel();
      this.session = undefined;
      session = await this.currentSession();
      response = await this.getWithBackoff(this.url(`/sites/${encodeURIComponent(session.siteId)}/views/${encodeURIComponent(viewId)}/data`, { maxAge: '1' }), session.token);
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Tableau view data returned HTTP ${response.status}`);
    }
    const contentType = response.headers.get('content-type') ?? '';
    if (!/^text\/csv(?:;|$)/i.test(contentType)) {
      await response.body?.cancel();
      throw new Error(`Tableau view data returned ${contentType || 'no content type'} instead of text/csv`);
    }
    return { body: await readLimitedBody(response, MAX_VIEW_BYTES), contentType, siteId: session.siteId };
  }

  private async currentSession(): Promise<Session> {
    if (this.session && this.session.expiresAt > Date.now()) return this.session;
    this.signingIn ??= this.signIn().finally(() => { this.signingIn = undefined; });
    return this.signingIn;
  }

  private async signIn(): Promise<Session> {
    if (!this.isConfigured()) throw new TableauNotConfiguredError('Tableau ETL is not configured: TABLEAU_API_BASE_URL, TABLEAU_PAT_NAME and TABLEAU_PAT_SECRET are required');
    const response = await fetch(this.url('/auth/signin'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        credentials: {
          personalAccessTokenName: this.config.get('TABLEAU_PAT_NAME'),
          personalAccessTokenSecret: this.config.get('TABLEAU_PAT_SECRET'),
          site: { contentUrl: this.config.get('TABLEAU_SITE_CONTENT_URL') },
        },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    // The status alone: the body of a failed sign-in is not logged or stored.
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Tableau sign-in returned HTTP ${response.status}`);
    }
    const parsed = (await response.json().catch(() => undefined)) as { credentials?: { token?: unknown; site?: { id?: unknown } } } | undefined;
    const token = parsed?.credentials?.token;
    const siteId = parsed?.credentials?.site?.id;
    if (typeof token !== 'string' || typeof siteId !== 'string' || !token || !siteId) throw new Error('Tableau sign-in response has no token or site id');
    this.session = { token, siteId, expiresAt: Date.now() + SESSION_TTL_MS };
    return this.session;
  }

  private async getWithBackoff(url: URL, token: string): Promise<Response> {
    for (let attempt = 0; ; attempt += 1) {
      const response = await fetch(url, { headers: { 'X-Tableau-Auth': token }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (response.status !== 429 || attempt >= MAX_RATE_LIMIT_RETRIES) return response;
      await response.body?.cancel();
      const retryAfter = Number(response.headers.get('retry-after'));
      await this.sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 60) * 1000 : 2000 * 2 ** attempt);
    }
  }

  private url(path: string, query: Record<string, string> = {}): URL {
    const origin = new URL(this.config.get('TABLEAU_API_BASE_URL')).origin;
    const url = new URL(`${origin}/api/${this.config.get('TABLEAU_API_VERSION')}${path}`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    return url;
  }
}

async function readLimitedBody(response: Response, maxBytes: number): Promise<string> {
  if (Number(response.headers.get('content-length') ?? 0) > maxBytes) {
    await response.body?.cancel();
    throw new Error(`Tableau response exceeds ${maxBytes} bytes`);
  }
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`Tableau response exceeds ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
