import type { Update } from '../types.js';
import { excerpt } from './prompt.js';
import bm25Vectorizer from 'wink-nlp/utilities/bm25-vectorizer.js';
import similarity from 'wink-nlp/utilities/similarity.js';

const STOP = new Set('a an and are as at be been by can for from has have how in into is it its new of on or our that the their this to update updates release releases software with you your'.split(' '));

export interface SimilarityClue {
  left: string;
  right: string;
  score: number;
  terms: string[];
}

function words(text: string): string[] {
  return (text.toLowerCase().match(/c\+\+|c#|\.net|[\p{L}\p{N}][\p{L}\p{N}._+-]*/gu) ?? [])
    .map((word) => word.replace(/[.-]+$/, ''))
    .filter((word) => word.length > 1 && !STOP.has(word) && !/^\d[\d.-]*$/.test(word));
}

/** Local lexical evidence, not authoritative clusters. Source labels are deliberately excluded. */
export function similarityClues(items: Update[]): SimilarityClue[] {
  if (items.length < 2) return [];
  const documents = items.map((item) => {
    const terms: string[] = [];
    const add = (text: string, weight: number) => {
      const tokens = words(text);
      const features = [...tokens];
      for (let i = 1; i < tokens.length; i++) {
        features.push(`${tokens[i - 1]} ${tokens[i]}`);
      }
      for (let i = 0; i < weight; i++) terms.push(...features);
    };
    add(item.title, 3);
    add(excerpt(item.content ?? '', 12_000), 1);
    return terms;
  });
  const vectorizer = bm25Vectorizer();
  for (const tokens of documents) vectorizer.learn(tokens);
  const vectors = documents.map((tokens) => vectorizer.bowOf(tokens));
  const candidates: Array<SimilarityClue & { a: number; b: number }> = [];
  for (let a = 0; a < items.length; a++) {
    for (let b = a + 1; b < items.length; b++) {
      const shared: Array<[string, number]> = [];
      for (const [term, weight] of Object.entries(vectors[a]!)) {
        const other = vectors[b]![term];
        if (other) shared.push([term, weight * other]);
      }
      // wink-nlp defines two empty bags as identical; they provide no grouping evidence.
      if (shared.length === 0) continue;
      const score = similarity.bow.cosine(vectors[a]!, vectors[b]!);
      if (score <= 0) continue;
      shared.sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));
      candidates.push({ a, b, left: items[a]!.id, right: items[b]!.id, score, terms: shared.slice(0, 5).map(([term]) => term) });
    }
  }
  // Bound prompt evidence, not visible group sizes. Each item nominates its three closest neighbours.
  const selected = new Set<SimilarityClue>();
  for (let i = 0; i < items.length; i++) {
    candidates.filter((pair) => pair.a === i || pair.b === i)
      .sort((a, b) => b.score - a.score).slice(0, 3).forEach((pair) => selected.add(pair));
  }
  return [...selected].map(({ left, right, score, terms }) => ({ left, right, score, terms }));
}
