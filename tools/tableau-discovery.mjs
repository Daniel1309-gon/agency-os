#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEFAULT_HOST = 'prod-uk-a.online.tableau.com';
const DEFAULT_API_VERSION = '3.29';
const DEFAULT_SITE_CONTENT_URL = 'partnerdata';
const MAX_BYTES = 50 * 1024 * 1024;
const MAX_ROWS = 250_000;
const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value || /^(YOUR_|<|change-me|replace-me)/i.test(value)) throw new Error(`${name} is missing or still a placeholder`);
  return value;
}

function redactUrl(url) {
  const parsed = new URL(url);
  for (const key of parsed.searchParams.keys()) parsed.searchParams.set(key, '<redacted>');
  return parsed.toString();
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function parseCsvShape(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < text.length && rows.length <= MAX_ROWS; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) { row.push(value); value = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(value); value = '';
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
    } else value += char;
  }
  if (value.length || row.length) { row.push(value); rows.push(row); }
  const headers = rows.shift() ?? [];
  return {
    headers: headers.map((header) => header.replace(/^\uFEFF/, '').trim()),
    rowCount: Math.max(0, rows.length),
    sampleRows: rows.slice(0, 3).map((cells) => Object.fromEntries(headers.map((header, index) => [header.trim(), cells[index] ?? '']))),
    rows,
  };
}

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'view';
}

function summarizeTemporalShape(shape) {
  const headers = shape.headers;
  const temporalHeaders = headers.filter((header) => /date|time|hour|hora/i.test(header) && !/diff|difference/i.test(header));
  const temporalColumns = temporalHeaders.map((header) => {
    const index = headers.indexOf(header);
    const values = shape.rows.map((row) => row[index] ?? '').filter(Boolean);
    const distinctValues = [...new Set(values)];
    return {
      header,
      distinctCount: distinctValues.length,
      sample: distinctValues.slice(0, 5),
      min: distinctValues[0],
      max: distinctValues.at(-1),
    };
  });
  return {
    headers,
    rowCount: shape.rowCount,
    temporalHeaders,
    temporalColumns,
    hasTemporalColumn: temporalHeaders.length > 0,
  };
}

function validateHost(baseUrl) {
  const parsed = new URL(baseUrl);
  if (parsed.protocol !== 'https:') throw new Error('TABLEAU_API_BASE_URL must use HTTPS');
  if (parsed.hostname !== DEFAULT_HOST) throw new Error(`Unexpected Tableau host: ${parsed.hostname}`);
  return parsed.origin;
}

function apiUrl(baseUrl, apiVersion, path, query = {}) {
  const url = new URL(`${baseUrl}/api/${apiVersion}${path}`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return url;
}

async function readLimitedBody(response) {
  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (contentLength > MAX_BYTES) throw new Error(`Response exceeds ${MAX_BYTES} bytes`);
  const reader = response.body?.getReader();
  if (!reader) return await response.text();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new Error(`Response exceeds ${MAX_BYTES} bytes`);
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

async function requestJson(url, options = {}) {
  const started = performance.now();
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(30_000) });
  const body = await readLimitedBody(response);
  let parsed;
  try { parsed = JSON.parse(body); } catch { parsed = undefined; }
  return { response, body, parsed, durationMs: Math.round(performance.now() - started) };
}

async function requestCsv(url, token, accept) {
  const started = performance.now();
  const headers = { 'X-Tableau-Auth': token };
  if (accept) headers.Accept = accept;
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(60_000) });
  const body = await readLimitedBody(response);
  const shape = response.ok && /^text\/csv(?:;|$)/i.test(response.headers.get('content-type') ?? '')
    ? parseCsvShape(body)
    : undefined;
  return {
    status: response.status,
    contentType: response.headers.get('content-type'),
    body,
    shape,
    durationMs: Math.round(performance.now() - started),
  };
}

async function requestBinary(url, token) {
  const started = performance.now();
  const response = await fetch(url, { headers: { 'X-Tableau-Auth': token }, signal: AbortSignal.timeout(60_000) });
  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (contentLength > MAX_BYTES) throw new Error(`Response exceeds ${MAX_BYTES} bytes`);
  const body = Buffer.from(await response.arrayBuffer());
  if (body.length > MAX_BYTES) throw new Error(`Response exceeds ${MAX_BYTES} bytes`);
  return {
    status: response.status,
    contentType: response.headers.get('content-type'),
    body,
    bytes: body.length,
    sha256: sha256(body),
    durationMs: Math.round(performance.now() - started),
  };
}

function paginationItems(parsed, collectionName) {
  const collection = parsed?.tsResponse?.[collectionName] ?? parsed?.[collectionName];
  const value = collection?.[collectionName.slice(0, -1)] ?? collection?.workbook ?? collection?.view ?? collection;
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function sanitizeWorkbook(workbook) {
  return {
    id: workbook.id,
    name: workbook.name,
    contentUrl: workbook.contentUrl,
    webpageUrl: workbook.webpageUrl ? redactUrl(workbook.webpageUrl) : undefined,
    project: workbook.project ? { id: workbook.project.id, name: workbook.project.name } : undefined,
    updatedAt: workbook.updatedAt,
    defaultViewId: workbook.defaultViewId,
  };
}

function sanitizeView(view, workbook) {
  const ownerWorkbook = workbook ?? view.workbook ?? {};
  return {
    id: view.id,
    name: view.name,
    contentUrl: view.contentUrl,
    workbookId: ownerWorkbook.id,
    workbookContentUrl: ownerWorkbook.contentUrl,
  };
}

async function main() {
  const baseUrl = validateHost(requiredEnv('TABLEAU_API_BASE_URL').replace(/\/$/, ''));
  const apiVersion = process.env.TABLEAU_API_VERSION?.trim() || DEFAULT_API_VERSION;
  const siteContentUrl = process.env.TABLEAU_SITE_CONTENT_URL?.trim() || DEFAULT_SITE_CONTENT_URL;
  const patName = requiredEnv('TABLEAU_PAT_NAME');
  const patSecret = requiredEnv('TABLEAU_PAT_SECRET');
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const rawDir = join(rootDir, '.local', 'tableau', runId);
  const evidenceDir = join(rootDir, 'tasks', 'evidence', 'tableau', runId);
  await mkdir(rawDir, { recursive: true });
  await mkdir(evidenceDir, { recursive: true });

  const manifest = {
    runId,
    startedAt: new Date().toISOString(),
    host: baseUrl,
    apiVersion,
    siteContentUrl,
    limits: { maxBytes: MAX_BYTES, maxRows: MAX_ROWS },
    requests: [],
    inventory: { workbooks: 0, views: 0 },
    revenue: {},
  };
  const record = (entry) => manifest.requests.push({ ...entry, recordedAt: new Date().toISOString() });

  const signinUrl = apiUrl(baseUrl, apiVersion, '/auth/signin');
  const signin = await requestJson(signinUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ credentials: { personalAccessTokenName: patName, personalAccessTokenSecret: patSecret, site: { contentUrl: siteContentUrl } } }),
  });
  record({ operation: 'signin', status: signin.response.status, durationMs: signin.durationMs });
  if (!signin.response.ok) throw new Error(`Tableau signin failed with HTTP ${signin.response.status}`);
  const credentials = signin.parsed?.credentials ?? signin.parsed?.tsResponse?.credentials;
  const token = credentials?.token;
  const site = credentials?.site;
  if (!token || !site?.id) throw new Error('Tableau signin response did not contain credentials token and site id');
  await writeFile(join(rawDir, 'signin-metadata.json'), JSON.stringify({ status: signin.response.status, site, user: credentials.user, estimatedTimeToExpiration: credentials.estimatedTimeToExpiration }, null, 2));

  const workbooks = [];
  for (let pageNumber = 1; ; pageNumber += 1) {
    const url = apiUrl(baseUrl, apiVersion, `/sites/${encodeURIComponent(site.id)}/workbooks`, { pageNumber: String(pageNumber), pageSize: '1000' });
    const result = await requestJson(url, { headers: { 'X-Tableau-Auth': token, Accept: 'application/json' } });
    record({ operation: 'list-workbooks', pageNumber, status: result.response.status, durationMs: result.durationMs });
    if (!result.response.ok) throw new Error(`Workbook inventory failed with HTTP ${result.response.status}`);
    const items = paginationItems(result.parsed, 'workbooks');
    workbooks.push(...items);
    const pagination = result.parsed?.pagination ?? result.parsed?.tsResponse?.pagination;
    if (workbooks.length >= Number(pagination?.totalAvailable ?? workbooks.length) || items.length === 0) break;
  }

  const inventory = [];
  const siteViews = [];
  let revenueView;
  for (const workbook of workbooks) {
    const url = apiUrl(baseUrl, apiVersion, `/sites/${encodeURIComponent(site.id)}/workbooks/${encodeURIComponent(workbook.id)}/views`);
    const result = await requestJson(url, { headers: { 'X-Tableau-Auth': token, Accept: 'application/json' } });
    record({ operation: 'list-views', workbookId: workbook.id, status: result.response.status, durationMs: result.durationMs });
    if (!result.response.ok) continue;
    const views = paginationItems(result.parsed, 'views');
    for (const view of views) {
      inventory.push(sanitizeView(view, workbook));
      const isRevenueWorkbook = workbook.contentUrl === 'Passport_16741406948180';
      const isRevenueView = view.name === 'Revenue detailed' || view.contentUrl?.endsWith('/Revenuedetailed');
      if (isRevenueWorkbook && isRevenueView) revenueView = { ...view, workbook };
    }
  }
  for (let pageNumber = 1; ; pageNumber += 1) {
    const url = apiUrl(baseUrl, apiVersion, `/sites/${encodeURIComponent(site.id)}/views`, { pageNumber: String(pageNumber), pageSize: '1000' });
    const result = await requestJson(url, { headers: { 'X-Tableau-Auth': token, Accept: 'application/json' } });
    record({ operation: 'list-site-views', pageNumber, status: result.response.status, durationMs: result.durationMs });
    if (!result.response.ok) break;
    const items = paginationItems(result.parsed, 'views');
    siteViews.push(...items.map((view) => sanitizeView(view)));
    const pagination = result.parsed?.pagination ?? result.parsed?.tsResponse?.pagination;
    if (siteViews.length >= Number(pagination?.totalAvailable ?? siteViews.length) || items.length === 0) break;
  }
  const allViews = [...inventory, ...siteViews.filter((siteView) => !inventory.some((view) => view.id === siteView.id))];
  const siteRevenueView = allViews.find((view) =>
    (view.workbookContentUrl === 'Passport_16741406948180' || view.contentUrl?.startsWith('Passport_16741406948180/'))
    && (view.name === 'Revenue detailed' || view.contentUrl?.endsWith('/Revenuedetailed')),
  );
  if (!revenueView && siteRevenueView) revenueView = { ...siteRevenueView, workbook: { id: siteRevenueView.workbookId, contentUrl: siteRevenueView.workbookContentUrl } };
  manifest.inventory = { workbooks: workbooks.length, workbookViews: inventory.length, siteViews: siteViews.length, views: allViews.length };
  await writeFile(join(rawDir, 'workbooks-sanitized.json'), JSON.stringify(workbooks.map(sanitizeWorkbook), null, 2));
  await writeFile(join(evidenceDir, 'inventory.json'), JSON.stringify({ workbooks: workbooks.map(sanitizeWorkbook), views: allViews }, null, 2));

  const temporalCandidates = allViews.filter((view) =>
    (view.workbookContentUrl === 'Passport_16741406948180' || view.contentUrl?.startsWith('Passport_16741406948180/'))
    && view.id !== revenueView?.id
    && /revenue|source|hour|point/i.test(`${view.name} ${view.contentUrl ?? ''}`),
  );
  manifest.temporalCandidates = [];
  for (const candidate of temporalCandidates) {
    const candidateUrl = apiUrl(baseUrl, apiVersion, `/sites/${encodeURIComponent(site.id)}/views/${encodeURIComponent(candidate.id)}/data`, { maxAge: '1' });
    const candidateResult = await requestCsv(candidateUrl, token);
    record({ operation: 'temporal-candidate-data', viewId: candidate.id, status: candidateResult.status, contentType: candidateResult.contentType, bytes: Buffer.byteLength(candidateResult.body), rowCount: candidateResult.shape?.rowCount, durationMs: candidateResult.durationMs });
    const candidateSlug = `${slugify(candidate.name)}-${candidate.id.slice(0, 8)}`;
    await writeFile(join(rawDir, `${candidateSlug}.csv`), candidateResult.body);
    const entry = {
      viewId: candidate.id,
      name: candidate.name,
      contentUrl: candidate.contentUrl,
      status: candidateResult.status,
      contentType: candidateResult.contentType,
      bytes: Buffer.byteLength(candidateResult.body),
      sha256: sha256(candidateResult.body),
      durationMs: candidateResult.durationMs,
      schema: candidateResult.shape ? summarizeTemporalShape(candidateResult.shape) : undefined,
    };
    const crosstabUrl = apiUrl(baseUrl, apiVersion, `/sites/${encodeURIComponent(site.id)}/views/${encodeURIComponent(candidate.id)}/crosstab/excel`, { maxAge: '1' });
    const crosstab = await requestBinary(crosstabUrl, token);
    record({ operation: 'temporal-candidate-crosstab', viewId: candidate.id, status: crosstab.status, contentType: crosstab.contentType, bytes: crosstab.bytes, durationMs: crosstab.durationMs });
    await writeFile(join(rawDir, `${candidateSlug}.xlsx`), crosstab.body);
    entry.crosstab = { status: crosstab.status, contentType: crosstab.contentType, bytes: crosstab.bytes, sha256: crosstab.sha256, durationMs: crosstab.durationMs };
    manifest.temporalCandidates.push(entry);
  }
  await writeFile(join(evidenceDir, 'temporal-candidates.json'), JSON.stringify(manifest.temporalCandidates, null, 2));

  if (!revenueView) {
    manifest.revenue = {
      status: 'UNRESOLVED',
      expectedWorkbookContentUrl: 'Passport_16741406948180',
      expectedViewContentUrl: 'Revenuedetailed',
      matchingCandidates: allViews.filter((view) => /revenue|passport/i.test(`${view.name} ${view.contentUrl ?? ''}`)).slice(0, 20),
    };
    await writeFile(join(evidenceDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    process.stdout.write(JSON.stringify({ runId, evidenceDir, rawDir, inventory: manifest.inventory, revenue: manifest.revenue }, null, 2));
    return;
  }
  const revenueUrl = apiUrl(baseUrl, apiVersion, `/sites/${encodeURIComponent(site.id)}/views/${encodeURIComponent(revenueView.id)}/data`, { maxAge: '1' });
  const baseline = await requestCsv(revenueUrl, token);
  record({ operation: 'revenue-data', viewId: revenueView.id, status: baseline.status, contentType: baseline.contentType, bytes: Buffer.byteLength(baseline.body), rowCount: baseline.shape?.rowCount, durationMs: baseline.durationMs });
  await writeFile(join(rawDir, 'revenue-detailed.csv'), baseline.body);
  if (baseline.status !== 200 || !baseline.shape) throw new Error(`Revenue detailed did not return CSV: HTTP ${baseline.status} ${baseline.contentType ?? ''}`);
  const revenueCrosstabUrl = apiUrl(baseUrl, apiVersion, `/sites/${encodeURIComponent(site.id)}/views/${encodeURIComponent(revenueView.id)}/crosstab/excel`, { maxAge: '1' });
  const revenueCrosstab = await requestBinary(revenueCrosstabUrl, token);
  record({ operation: 'revenue-crosstab-excel', viewId: revenueView.id, status: revenueCrosstab.status, contentType: revenueCrosstab.contentType, bytes: revenueCrosstab.bytes, durationMs: revenueCrosstab.durationMs });
  await writeFile(join(rawDir, 'revenue-detailed.xlsx'), revenueCrosstab.body);
  manifest.revenue = {
    workbookId: revenueView.workbook.id,
    workbookContentUrl: revenueView.workbook.contentUrl,
    viewId: revenueView.id,
    viewName: revenueView.name,
    viewContentUrl: revenueView.contentUrl,
    status: baseline.status,
    contentType: baseline.contentType,
    bytes: Buffer.byteLength(baseline.body),
    rowCount: baseline.shape.rowCount,
    headers: baseline.shape.headers,
    sha256: sha256(baseline.body),
    durationMs: baseline.durationMs,
    crosstab: { status: revenueCrosstab.status, contentType: revenueCrosstab.contentType, bytes: revenueCrosstab.bytes, sha256: revenueCrosstab.sha256, durationMs: revenueCrosstab.durationMs },
  };
  await writeFile(join(evidenceDir, 'revenue-detailed-schema.json'), JSON.stringify({ ...manifest.revenue, sampleRows: undefined }, null, 2));

  const explicitCsv = await requestCsv(revenueUrl, token, 'text/csv');
  record({ operation: 'revenue-data-accept-text-csv', viewId: revenueView.id, status: explicitCsv.status, contentType: explicitCsv.contentType, bytes: Buffer.byteLength(explicitCsv.body), durationMs: explicitCsv.durationMs });
  const sample = baseline.shape.sampleRows[0] ?? {};
  const filterCandidates = [
    ['Revenue type', sample['Revenue type'], 'observed-value'],
    ['Max Hour', sample['Max Hour'], 'observed-value'],
    ['ID Trusted User', sample['ID Trusted User'], 'observed-value'],
    ['source ID ', sample['source ID '] ?? sample['source ID'], 'observed-value'],
    ['Date', '2026-08-14', 'guide-candidate'],
    ['__AgencyOSInvalidField', '__AgencyOSInvalidValue', 'invalid-sentinel'],
  ].filter(([, value]) => value !== undefined && value !== '');
  const filterResults = [];
  for (const [field, value, candidateType] of filterCandidates) {
    const filteredUrl = apiUrl(baseUrl, apiVersion, `/sites/${encodeURIComponent(site.id)}/views/${encodeURIComponent(revenueView.id)}/data`, { maxAge: '1', [`vf_${field}`]: value });
    const result = await requestCsv(filteredUrl, token);
    const bodyHash = sha256(result.body);
    filterResults.push({ field, candidateType, value: '<redacted>', status: result.status, contentType: result.contentType, bytes: Buffer.byteLength(result.body), sha256: bodyHash, rowCount: result.shape?.rowCount, headers: result.shape?.headers, changedFromBaseline: bodyHash !== manifest.revenue.sha256, durationMs: result.durationMs });
  }
  await writeFile(join(evidenceDir, 'filter-results.json'), JSON.stringify(filterResults, null, 2));
  try {
    const signoutUrl = apiUrl(baseUrl, apiVersion, '/auth/signout');
    const signout = await fetch(signoutUrl, { method: 'POST', headers: { 'X-Tableau-Auth': token }, signal: AbortSignal.timeout(30_000) });
    record({ operation: 'signout', status: signout.status });
  } catch (error) {
    record({ operation: 'signout', status: 'ERROR', error: error instanceof Error ? error.message : 'unknown' });
  }
  await writeFile(join(evidenceDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  process.stdout.write(JSON.stringify({ runId, evidenceDir, rawDir, inventory: manifest.inventory, revenue: { viewId: manifest.revenue.viewId, bytes: manifest.revenue.bytes, rowCount: manifest.revenue.rowCount, sha256: manifest.revenue.sha256 }, filterResults }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { process.stderr.write(`Tableau discovery failed: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
}

export { parseCsvShape, validateHost, apiUrl, redactUrl };
