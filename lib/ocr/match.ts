import { foldLabel, labelTokens } from "@/lib/ocr/normalize";

export const MATCH_THRESHOLD = 0.5;

export type MatchCandidate = {
  id: string;
  name: string;
  supplierId?: string | null;
};

export type LabelMatch = {
  id: string;
  score: number;
};

export function scoreLabels(query: string, candidate: string): number {
  const a = foldLabel(query);
  const b = foldLabel(candidate);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) {
    const shorter = Math.min(a.length, b.length);
    const longer = Math.max(a.length, b.length);
    return 0.72 + 0.23 * (shorter / longer);
  }

  const qa = labelTokens(query);
  const qb = labelTokens(candidate);
  if (qa.length === 0 || qb.length === 0) return 0;

  const setB = new Set(qb);
  let overlap = 0;
  for (const token of qa) if (setB.has(token)) overlap++;
  if (overlap === 0) return 0;

  const jaccard = overlap / (qa.length + qb.length - overlap);
  const coverage = overlap / qb.length;
  return Math.max(jaccard, coverage * 0.92);
}

export function bestMatch(query: string, candidates: MatchCandidate[], preferredSupplierId?: string | null): LabelMatch | null {
  let best: LabelMatch | null = null;
  for (const candidate of candidates) {
    let score = scoreLabels(query, candidate.name);
    if (preferredSupplierId && candidate.supplierId === preferredSupplierId) score = Math.min(1, score + 0.08);
    if (!best || score > best.score) best = { id: candidate.id, score };
  }
  if (!best || best.score < MATCH_THRESHOLD) return null;
  return best;
}

export function matchMany(
  labels: string[],
  candidates: MatchCandidate[],
  preferredSupplierId?: string | null
): Array<LabelMatch | null> {
  return labels.map((label) => bestMatch(label, candidates, preferredSupplierId));
}
