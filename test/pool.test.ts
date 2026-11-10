import { describe, expect, it } from "vitest";
import { type Grade, LIMITS, keyOf, nextOpen, pace, parsePool, parseQrels, places, toQrels } from "../src/pool";

const line = (q: string, d: string, extra: object = {}) => JSON.stringify({ query_id: q, query: `query ${q}`, doc_id: d, ...extra });

describe("parsePool", () => {
  it("groups by query, keeps every document, reports bad lines", () => {
    const text = [line("q1", "a"), "not json", line("q2", "x"), line("q1", "b"), "[1,2]", JSON.stringify({ query_id: "q3" }), line("q1", "a")].join("\n");
    const p = parsePool(text);
    expect(p.items.map((i) => i.queryId)).toEqual(["q1", "q1", "q2"]);
    expect(new Set(p.items.map((i) => i.docId))).toEqual(new Set(["a", "b", "x"]));
    expect(p.queries).toBe(2);
    expect(p.problems).toEqual(["line 2: not a JSON object", "line 5: not a JSON object", "line 6: needs query_id, query and doc_id", "line 7: repeats line 1"]);
  });

  it("orders documents blind but the same on every load", () => {
    const text = Array.from({ length: 30 }, (_, i) => line("q", `d${i}`)).join("\n");
    const a = parsePool(text).items.map((i) => i.docId);
    expect(a).toEqual(parsePool(text).items.map((i) => i.docId));
    expect(a).not.toEqual(Array.from({ length: 30 }, (_, i) => `d${i}`));
    expect(new Set(a).size).toBe(30);
  });

  it("refuses ids that would break the qrels file, and clips huge fields", () => {
    const p = parsePool([line("q\t1", "a"), line("q", "b\nc"), line("q", "ok", { text: "x".repeat(LIMITS.field + 50) })].join("\n"));
    expect(p.items.map((i) => i.docId)).toEqual(["ok"]);
    expect(p.problems).toHaveLength(2);
    expect(p.items[0].text.length).toBe(LIMITS.field);
  });

  it("accepts numeric ids and missing title and text", () => {
    const p = parsePool(JSON.stringify({ query_id: 7, query: "q", doc_id: 12 }));
    expect(p.items[0]).toEqual({ queryId: "7", query: "q", docId: "12", title: "", text: "" });
  });

  it("gives the same pool the same hash, and a different pool another", () => {
    expect(parsePool(line("q", "a")).hash).toBe(parsePool(line("q", "a")).hash);
    expect(parsePool(line("q", "a")).hash).not.toBe(parsePool(line("q", "b")).hash);
  });
});

describe("qrels", () => {
  it("round-trips in relevance-gate's format, in pool order", () => {
    const p = parsePool([line("q1", "a"), line("q1", "b"), line("q2", "c")].join("\n"));
    const g = new Map<string, Grade>([[keyOf(p.items[2]), 0], [keyOf(p.items[0]), 2]]);
    const tsv = toQrels(p.items, g);
    expect(tsv.split("\n")[0]).toBe("query-id\tcorpus-id\tscore");
    expect(tsv.trim().split("\n")).toHaveLength(3);
    expect(parseQrels(tsv)).toEqual(g);
  });

  it("ignores bad rows and scores outside 0 to 2", () => {
    expect([...parseQrels("query-id\tcorpus-id\tscore\nq\ta\t3\nq\tb\t1\nbroken\nq\tc\t-1\n")]).toEqual([["q\tb", 1]]);
  });
});

describe("navigation and pace", () => {
  it("finds the next ungraded document, wrapping, and -1 when done", () => {
    const p = parsePool([line("q", "a"), line("q", "b"), line("q", "c")].join("\n"));
    const g = new Map<string, Grade>([[keyOf(p.items[1]), 1]]);
    expect(nextOpen(p.items, g, 0)).toBe(2);
    expect(nextOpen(p.items, g, 2)).toBe(0);
    p.items.forEach((i) => g.set(keyOf(i), 0));
    expect(nextOpen(p.items, g, 0)).toBe(-1);
  });

  it("knows where every document is, and each query's number and size", () => {
    const p = parsePool([line("q1", "a"), line("q2", "x"), line("q1", "b"), line("q2", "y"), line("q2", "z")].join("\n"));
    const w = places(p.items);
    expect([...w.queries]).toEqual([["q1", { n: 1, start: 0, size: 2 }], ["q2", { n: 2, start: 2, size: 3 }]]);
    p.items.forEach((item, i) => expect(w.at.get(keyOf(item))).toBe(i));
  });

  it("counts grades per minute without long pauses", () => {
    expect(pace([0, 1000, 2000])).toBeNull();
    expect(pace([0, 2000, 4000, 6000, 8000])).toBe(30);
    expect(pace([0, 2000, 4000, 6000, 8000 + 3_600_000])).toBeCloseTo(4 / ((6000 + 120_000) / 60_000));
  });
});
