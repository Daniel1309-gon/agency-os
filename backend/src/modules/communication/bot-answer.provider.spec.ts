import { describe, expect, it } from 'vitest';
import { FaqBotAnswerProvider, type BotKnowledgeArticle } from './bot-answer.provider.js';

const article = (overrides: Partial<BotKnowledgeArticle> = {}): BotKnowledgeArticle => ({
  slug: 'turnos',
  version: 1,
  question: '¿Cómo consulto mi turno?',
  answer: 'Consulta tu turno en el panel.',
  keywords: ['turno', 'horario'],
  crewIds: [],
  ...overrides,
});

describe('FaqBotAnswerProvider', () => {
  it('returns the highest keyword match and uses the newest version as tie breaker', () => {
    const provider = new FaqBotAnswerProvider();

    const result = provider.answer('¿Cuál es mi horario de turno?', [
      article({ slug: 'general', version: 9, answer: 'Respuesta general', keywords: ['turno'] }),
      article({ slug: 'especifico', version: 2, answer: 'Respuesta específica', keywords: ['turno', 'horario'] }),
    ]);

    expect(result).toEqual({ slug: 'especifico', version: 2, answer: 'Respuesta específica' });
  });

  it('returns no answer when no approved keyword matches', () => {
    const provider = new FaqBotAnswerProvider();

    expect(provider.answer('cambia mi usuario', [article()])).toBeUndefined();
  });
});
