// Pool files, blind ordering, and qrels in the format relevance-gate reads.

export type Grade = 0 | 1 | 2;

export interface Item {
  queryId: string;
  query: string;
  docId: string;
  title: string;
  text: string;
}

export interface Pool {
  items: Item[];
  queries: number;
  hash: string;
  problems: string[];
}

export const LIMITS = { bytes: 50 * 1024 * 1024, items: 100_000, field: 20_000 };

const str = (v: unknown): string | null =>
  typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : null;

/** A fast 53 bit string hash (cyrb53). Keys saved progress to a pool; not a security boundary. */
export function hash(text: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** Shuffle a query's documents with a seed taken from the query, so the order is the same on every load
 * and gives no hint of which search config ranked a document first. */
function blind<T>(xs: T[], seed: string): T[] {
  const out = xs.slice();
  let s = parseInt(hash(seed), 36) % 2147483647 || 1;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 48271) % 2147483647;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Parse a pool: JSON lines of {query_id, query, doc_id, title?, text?}. Bad lines are reported, not fatal. */
export function parsePool(text: string): Pool {
  const problems: string[] = [];
  if (text.length > LIMITS.bytes) throw new Error(`the file is larger than ${LIMITS.bytes / 1024 / 1024} MB`);
  const byQuery = new Map<string, Item[]>();
  const seen = new Map<string, number>();
  const lines = text.split(/\r?\n/);
  let count = 0;
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n].trim();
    if (!line) continue;
    let row: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(line);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      row = parsed as Record<string, unknown>;
    } catch {
      problems.push(`line ${n + 1}: not a JSON object`);
      continue;
    }
    const queryId = str(row.query_id);
    const docId = str(row.doc_id);
    const query = str(row.query);
    if (!queryId || !docId || query === null) {
      problems.push(`line ${n + 1}: needs query_id, query and doc_id`);
      continue;
    }
    if (/[\t\r\n]/.test(queryId + docId)) {
      problems.push(`line ${n + 1}: ids cannot contain tabs or line breaks`);
      continue;
    }
    const key = `${queryId}\t${docId}`;
    const first = seen.get(key);
    if (first !== undefined) {
      problems.push(`line ${n + 1}: repeats line ${first}`);
      continue;
    }
    seen.set(key, n + 1);
    if (++count > LIMITS.items) throw new Error(`more than ${LIMITS.items} documents to judge`);
    const clip = (s: string | null) => (s ?? "").slice(0, LIMITS.field);
    const item = { queryId, query: clip(query), docId, title: clip(str(row.title)), text: clip(str(row.text)) };
    const list = byQuery.get(queryId);
    if (list) list.push(item);
    else byQuery.set(queryId, [item]);
  }
  const items = [...byQuery.entries()].flatMap(([q, list]) => blind(list, q));
  return { items, queries: byQuery.size, hash: hash(items.map((i) => `${i.queryId}\t${i.docId}`).join("\n")), problems };
}

export const keyOf = (i: { queryId: string; docId: string }) => `${i.queryId}\t${i.docId}`;

export interface Places {
  /** Where each document is in the pool, by its key. */
  at: Map<string, number>;
  /** Each query's number (from 1), where its documents start, and how many there are. */
  queries: Map<string, { n: number; start: number; size: number }>;
}

/** Look up once where everything is, so showing "query 3 of 40, document 2 of 10" does not walk the pool on
 * every key press. A query's documents sit together, as parsePool lays them out. */
export function places(items: Item[]): Places {
  const at = new Map<string, number>();
  const queries: Places["queries"] = new Map();
  items.forEach((item, i) => {
    at.set(keyOf(item), i);
    const q = queries.get(item.queryId);
    if (q) q.size++;
    else queries.set(item.queryId, { n: queries.size + 1, start: i, size: 1 });
  });
  return { at, queries };
}

/** qrels TSV as relevance-gate writes it: a header, then query-id, corpus-id, score. In pool order. Only what
 * was graded here: `relevance-gate judge --take` adds it to a qrels file that already has grades. */
export function toQrels(items: Item[], grades: Map<string, Grade>): string {
  const rows = items.filter((i) => grades.has(keyOf(i))).map((i) => `${i.queryId}\t${i.docId}\t${grades.get(keyOf(i))}`);
  return ["query-id\tcorpus-id\tscore", ...rows].join("\n") + "\n";
}

/** Read existing qrels (from relevance-gate's terminal judge, or an earlier export) to continue from them. */
export function parseQrels(text: string): Map<string, Grade> {
  const out = new Map<string, Grade>();
  for (const line of text.split(/\r?\n/)) {
    const [q, d, s] = line.split("\t");
    if (!q || !d || s === undefined || q === "query-id") continue;
    const g = Number(s.trim());
    if (g === 0 || g === 1 || g === 2) out.set(`${q}\t${d}`, g);
  }
  return out;
}

/** Index of the next ungraded item after `from`, wrapping around; -1 when everything is graded. */
export function nextOpen(items: Item[], grades: Map<string, Grade>, from: number): number {
  for (let k = 1; k <= items.length; k++) {
    const i = (from + k) % items.length;
    if (!grades.has(keyOf(items[i]))) return i;
  }
  return -1;
}

/** Grades per minute over the session, not counting pauses longer than two minutes. */
export function pace(times: number[]): number | null {
  if (times.length < 5) return null;
  let active = 0;
  for (let i = 1; i < times.length; i++) active += Math.min(times[i] - times[i - 1], 120_000);
  return active > 0 ? ((times.length - 1) / active) * 60_000 : null;
}
