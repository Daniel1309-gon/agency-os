import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TableauClient, TableauNotConfiguredError } from './tableau.client.js';
import type { ConfigService } from '../../config/config.service.js';

const SETTINGS: Record<string, string> = {
  TABLEAU_API_BASE_URL: 'https://prod-uk-a.online.tableau.com/',
  TABLEAU_API_VERSION: '3.29',
  TABLEAU_SITE_CONTENT_URL: 'partnerdata',
  TABLEAU_PAT_NAME: 'etl-pat',
  TABLEAU_PAT_SECRET: 'pat-secret',
};

function client(overrides: Record<string, string> = {}): TableauClient {
  const values = { ...SETTINGS, ...overrides };
  const instance = new TableauClient({ get: (key: string) => values[key] ?? '' } as unknown as ConfigService);
  instance.useSleep(async () => undefined);
  return instance;
}

const signInOk = (token = 'session-1') => new Response(JSON.stringify({ credentials: { token, site: { id: 'site-luid', contentUrl: 'partnerdata' } } }), { status: 200, headers: { 'content-type': 'application/json' } });
const csv = (body = 'Profile,Points\nTU-1,5\n') => new Response(body, { status: 200, headers: { 'content-type': 'text/csv; charset=utf-8' } });

/** A scripted stub server: one queued response per call, recorded with its request. */
let script: Array<(url: URL, init: RequestInit) => Response>;
let calls: Array<{ url: URL; init: RequestInit }>;

beforeEach(() => {
  script = [];
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (input: URL | string, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    const next = script.shift();
    if (!next) throw new Error(`unexpected request ${url}`);
    return next(url, init);
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TableauClient.downloadViewData', () => {
  it('signs in with the PAT under /api/{version} and downloads the view without an Accept header', async () => {
    script.push(() => signInOk(), () => csv());

    await expect(client().downloadViewData('view-luid')).resolves.toEqual({ body: 'Profile,Points\nTU-1,5\n', contentType: 'text/csv; charset=utf-8', siteId: 'site-luid' });

    const [signIn, data] = calls;
    expect(signIn.url.toString()).toBe('https://prod-uk-a.online.tableau.com/api/3.29/auth/signin');
    expect(JSON.parse(String(signIn.init.body))).toEqual({ credentials: { personalAccessTokenName: 'etl-pat', personalAccessTokenSecret: 'pat-secret', site: { contentUrl: 'partnerdata' } } });
    expect(data.url.toString()).toBe('https://prod-uk-a.online.tableau.com/api/3.29/sites/site-luid/views/view-luid/data?maxAge=1');
    expect(data.init.headers).toEqual({ 'X-Tableau-Auth': 'session-1' });
  });

  it('shares one sign-in between concurrent downloads and reuses the session afterwards', async () => {
    script.push(() => signInOk(), () => csv(), () => csv(), () => csv());
    const tableau = client();

    await Promise.all([tableau.downloadViewData('a'), tableau.downloadViewData('b')]);
    await tableau.downloadViewData('c');

    expect(calls.filter((call) => call.url.pathname.endsWith('/auth/signin'))).toHaveLength(1);
  });

  it('signs in again once on 401 and retries the download with the new session', async () => {
    script.push(() => signInOk('old'), () => new Response('', { status: 401 }), () => signInOk('new'), () => csv());

    await expect(client().downloadViewData('view-luid')).resolves.toMatchObject({ siteId: 'site-luid' });
    expect(calls.at(-1)?.init.headers).toEqual({ 'X-Tableau-Auth': 'new' });
  });

  it('gives up after a second 401 instead of looping', async () => {
    script.push(() => signInOk(), () => new Response('', { status: 401 }), () => signInOk(), () => new Response('', { status: 401 }));

    await expect(client().downloadViewData('view-luid')).rejects.toThrow('Tableau view data returned HTTP 401');
    expect(calls).toHaveLength(4);
  });

  it('backs off on 429, honouring Retry-After, then succeeds', async () => {
    const waits: number[] = [];
    const tableau = client();
    tableau.useSleep(async (ms) => { waits.push(ms); });
    script.push(() => signInOk(), () => new Response('', { status: 429, headers: { 'retry-after': '7' } }), () => new Response('', { status: 429 }), () => csv());

    await expect(tableau.downloadViewData('view-luid')).resolves.toMatchObject({ siteId: 'site-luid' });
    expect(waits).toEqual([7000, 4000]);
  });

  it('stops after three rate-limit retries', async () => {
    script.push(() => signInOk(), ...Array.from({ length: 4 }, () => () => new Response('', { status: 429 })));

    await expect(client().downloadViewData('view-luid')).rejects.toThrow('HTTP 429');
  });

  it('rejects a response that is not CSV, such as the 200 HTML of a wrong view', async () => {
    script.push(() => signInOk(), () => new Response('<html/>', { status: 200, headers: { 'content-type': 'text/html' } }));

    await expect(client().downloadViewData('view-luid')).rejects.toThrow('returned text/html instead of text/csv');
  });

  it('rejects a body larger than the cap without reading it all', async () => {
    script.push(() => signInOk(), () => new Response('x', { status: 200, headers: { 'content-type': 'text/csv', 'content-length': String(60 * 1024 * 1024) } }));

    await expect(client().downloadViewData('view-luid')).rejects.toThrow('exceeds');
  });

  it('reports a failed sign-in by status only, never with the response body', async () => {
    script.push(() => new Response('{"error":{"detail":"pat-secret is wrong"}}', { status: 401 }));

    const error = (await client().downloadViewData('view-luid').catch((caught: unknown) => caught)) as Error;
    expect(error.message).toBe('Tableau sign-in returned HTTP 401');
  });

  it('does not call Tableau at all when the PAT is not configured', async () => {
    await expect(client({ TABLEAU_PAT_SECRET: '' }).downloadViewData('view-luid')).rejects.toBeInstanceOf(TableauNotConfiguredError);
    expect(calls).toHaveLength(0);
  });
});
