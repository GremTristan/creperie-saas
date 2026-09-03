export function foldLabel(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const STOP = new Set([
  "de",
  "du",
  "des",
  "la",
  "le",
  "les",
  "en",
  "au",
  "aux",
  "et",
  "ou",
  "kg",
  "g",
  "gr",
  "l",
  "ml",
  "cl",
  "pc",
  "pcs",
  "piece",
  "pieces",
  "unite",
  "unites",
  "sachet",
  "sac",
  "pot",
  "boite",
  "carton",
  "x",
]);

export function labelTokens(value: string): string[] {
  return foldLabel(value)
    .split(" ")
    .filter((token) => token.length > 1 && !STOP.has(token));
}

export function parseAmount(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return roundMoney(raw);
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/\s/g, "").replace(/'/g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? roundMoney(n) : null;
}

export function parseQuantity(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return roundQty(raw);
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/\s/g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? roundQty(n) : null;
}

export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

export function roundQty(n: number): number {
  return Math.round(n * 10000) / 10000;
}
