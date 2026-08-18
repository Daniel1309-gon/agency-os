import { Injectable } from '@nestjs/common';

export interface BotKnowledgeArticle {
  slug: string;
  version: number;
  question: string;
  answer: string;
  keywords: string[];
  crewIds: string[];
}

export interface BotAnswer {
  slug: string;
  version: number;
  answer: string;
}

export interface BotAnswerProvider {
  answer(question: string, articles: readonly BotKnowledgeArticle[]): BotAnswer | undefined;
}

export const BOT_ANSWER_PROVIDER = Symbol('agency-os.bot-answer-provider');

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
}

/** Deterministic provider over the approved FAQ catalogue. */
@Injectable()
export class FaqBotAnswerProvider implements BotAnswerProvider {
  answer(question: string, articles: readonly BotKnowledgeArticle[]): BotAnswer | undefined {
    const normalizedQuestion = normalize(question);
    const selected = articles
      .map((article) => ({
        article,
        score: article.keywords.filter((keyword) => normalizedQuestion.includes(normalize(keyword))).length,
      }))
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => right.score - left.score || right.article.version - left.article.version || left.article.slug.localeCompare(right.article.slug))[0]
      ?.article;
    return selected ? { slug: selected.slug, version: selected.version, answer: selected.answer } : undefined;
  }
}
