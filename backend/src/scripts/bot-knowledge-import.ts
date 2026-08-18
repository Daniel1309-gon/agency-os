import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { botKnowledgeFileSchema, botKnowledgeSchema, type BotKnowledgeFile } from '../modules/communication/communication.schemas.js';

interface KnowledgeRow {
  slug: string;
  value: BotKnowledgeFile;
}

const baseUrl = (process.env.BOT_KNOWLEDGE_API_URL ?? `http://127.0.0.1:${process.env.PORT ?? '3000'}/api/v1`).replace(/\/$/, '');

function comparable(value: BotKnowledgeFile | { version: number; question: string; answer: string; keywords: string[]; crewIds: string[] }) {
  return JSON.stringify({ version: value.version, question: value.question, answer: value.answer, keywords: value.keywords, crewIds: value.crewIds });
}

async function getToken(): Promise<string> {
  const configured = process.env.BOT_KNOWLEDGE_ADMIN_JWT?.trim();
  if (configured) return configured;
  const email = process.env.BOT_KNOWLEDGE_ADMIN_EMAIL?.trim() || process.env.BOOTSTRAP_ADMIN_EMAIL?.trim();
  const password = process.env.BOT_KNOWLEDGE_ADMIN_PASSWORD || process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!email || !password) throw new Error('Provide BOT_KNOWLEDGE_ADMIN_JWT or temporary admin login variables');
  const response = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await response.json().catch(() => ({})) as { accessToken?: unknown };
  if (!response.ok || typeof body.accessToken !== 'string') throw new Error(`Temporary admin login failed (${response.status})`);
  return body.accessToken;
}

async function request<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  });
  if (!response.ok) throw new Error(`Knowledge API request failed (${response.status})`);
  return response.json() as Promise<T>;
}

async function readKnowledgeFiles(): Promise<BotKnowledgeFile[]> {
  const directory = fileURLToPath(new URL('../../knowledge', import.meta.url));
  const names = (await readdir(directory)).filter((name) => name.endsWith('.json')).sort();
  const seen = new Set<string>();
  const articles: BotKnowledgeFile[] = [];
  for (const name of names) {
    const parsed = botKnowledgeFileSchema.safeParse(JSON.parse(await readFile(join(directory, name), 'utf8')));
    if (!parsed.success) throw new Error(`Invalid knowledge file: ${name}`);
    if (seen.has(parsed.data.slug)) throw new Error(`Duplicate knowledge slug: ${parsed.data.slug}`);
    seen.add(parsed.data.slug);
    articles.push(parsed.data);
  }
  return articles;
}

async function main(): Promise<void> {
  const token = await getToken();
  const current = await request<KnowledgeRow[]>('/rocketchat/bot/knowledge', token);
  const currentBySlug = new Map(current.map((row) => [row.slug, row.value]));
  let imported = 0;
  let skipped = 0;

  for (const article of await readKnowledgeFiles()) {
    const existing = currentBySlug.get(article.slug);
    if (existing && comparable(existing) === comparable(article)) {
      skipped += 1;
      continue;
    }
    if (existing && article.version <= existing.version) {
      throw new Error(`Knowledge version must increase: ${article.slug}`);
    }
    const { slug, ...value } = article;
    await request(`/rocketchat/bot/knowledge/${encodeURIComponent(slug)}`, token, {
      method: 'PUT',
      body: JSON.stringify(botKnowledgeSchema.parse(value)),
    });
    imported += 1;
  }
  process.stdout.write(`Knowledge import complete: ${imported} imported, ${skipped} unchanged\n`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Knowledge import failed');
  process.exitCode = 1;
});
