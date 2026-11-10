// @vitest-environment node
/// <reference types="node" />
// judge-ui and relevance-gate pass two files between them: the pool one way, the grades back. Each repo tests its
// own half against a format written down in a README. This runs the two programs on each other's real output, two
// rounds, and checks that no grade is lost on the way.
//
// It needs `relevance-gate` (0.2.0 or later) on the PATH and is skipped without it. CI installs it and sets
// NEED_RELEVANCE_GATE, so there a missing install fails instead of skipping.
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type Grade, keyOf, parsePool, parseQrels, toQrels } from "../src/pool";

const have = spawnSync("relevance-gate", ["--version"]).status === 0;
const rg = (...args: string[]) => execFileSync("relevance-gate", args, { encoding: "utf8" });
const jsonl = (rows: object[]) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";

const AWKWARD = 'He said "six minutes".\tThen a tab, a line\nbreak, <script>alert(1)</script> and naïve café.';

describe.skipIf(!have && !process.env.NEED_RELEVANCE_GATE)("with relevance-gate", () => {
  it("grades two rounds in the browser and loses nothing on the way back", () => {
    expect(have, "relevance-gate is not on the PATH").toBe(true);
    const dir = mkdtempSync(join(tmpdir(), "judge-ui-"));
    try {
      const data = join(dir, "my search"); // a space, as real folders have
      const [pool, grades] = [join(dir, "pool.jsonl"), join(dir, "grades.tsv")];
      const qrels = join(data, "qrels", "test.tsv");
      mkdirSync(data);
      writeFileSync(join(data, "queries.jsonl"), jsonl([{ _id: "q1", text: "boil an egg" }, { _id: "q 2", text: "train to edinburgh" }]));
      writeFileSync(
        join(data, "corpus.jsonl"),
        jsonl([
          { _id: "e1", title: "Boiled eggs", text: "Boil the egg for six minutes." },
          { _id: "e 2", title: "Egg nutrition", text: AWKWARD },
          { _id: "t1", title: "Edinburgh by rail", text: "The train takes four and a half hours." },
          { _id: "ü3", title: "Sleeper train", text: "The overnight train, Edinburgh by morning." },
        ]),
      );

      // Round 1: relevance-gate writes the pool, judge-ui reads it, grades, exports; relevance-gate takes it.
      expect(rg("judge", "--data", data, "--pool-out", pool)).toContain("--take");
      const first = parsePool(readFileSync(pool, "utf8"));
      expect(first.problems).toEqual([]);
      expect(first.items.map(keyOf).sort()).toEqual(["q 2\tt1", "q 2\tü3", "q1\te 2", "q1\te1"]);
      expect(first.items.find((i) => i.docId === "e 2")!.text).toBe(AWKWARD);
      const round1 = new Map(first.items.map((item, i) => [keyOf(item), (i % 3) as Grade]));
      writeFileSync(grades, toQrels(first.items, round1));
      expect(rg("judge", "--data", data, "--take", grades)).toMatch(/^4 grades added .* 0 changed, 0 kept \(4 in all\)/);
      expect(parseQrels(readFileSync(qrels, "utf8"))).toEqual(round1);

      // Round 2: one more query. The pool holds only what is not judged yet, so the export does too.
      appendFileSync(join(data, "queries.jsonl"), jsonl([{ _id: "q3", text: "egg" }]));
      rg("judge", "--data", data, "--pool-out", pool);
      const second = parsePool(readFileSync(pool, "utf8"));
      expect(second.items.map(keyOf).sort()).toEqual(["q3\te 2", "q3\te1"]);
      const round2 = new Map(second.items.map((item) => [keyOf(item), 2 as Grade]));
      writeFileSync(grades, toQrels(second.items, round2));
      expect(parseQrels(readFileSync(grades, "utf8")).size).toBe(2); // saved over the qrels file, this is all that would be left
      expect(rg("judge", "--data", data, "--take", grades)).toMatch(/^2 grades added .* 0 changed, 4 kept \(6 in all\)/);
      expect(parseQrels(readFileSync(qrels, "utf8"))).toEqual(new Map([...round1, ...round2]));

      // And relevance-gate reads all of it as judged: nothing is left to grade.
      expect(rg("judge", "--data", data, "--pool-out", pool)).toMatch(/^0 documents /);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
