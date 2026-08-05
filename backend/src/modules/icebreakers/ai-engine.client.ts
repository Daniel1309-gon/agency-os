import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { ConfigService } from '../../config/config.service.js';

const evaluationSchema = z.object({
  status: z.enum(['APPROVED', 'BLOCKED']),
  score: z.number().min(0).max(1),
  result: z.record(z.unknown()).default({}),
  model: z.string().max(160).optional(),
  tokenCostUsd: z.number().nonnegative().optional(),
});

export type AiEvaluation = z.infer<typeof evaluationSchema>;

@Injectable()
export class AiEngineClient {
  constructor(private readonly config: ConfigService) {}

  async evaluate(text: string, rules: Array<{ code: string; severity: string }>): Promise<AiEvaluation | undefined> {
    const baseUrl = this.config.get('AI_ENGINE_URL');
    if (!baseUrl) return undefined;
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/evaluate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.config.get('AI_ENGINE_TOKEN')}` },
      body: JSON.stringify({ text, rules }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`ai-engine returned HTTP ${response.status}`);
    const parsed = evaluationSchema.safeParse(await response.json());
    if (!parsed.success) throw new Error('ai-engine returned an invalid evaluation');
    return parsed.data;
  }
}
