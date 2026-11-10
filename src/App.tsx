import { useCallback, useEffect, useMemo, useState } from "react";
import { type Grade, LIMITS, type Pool, keyOf, nextOpen, pace, parsePool, parseQrels, places, toQrels } from "./pool";
import { SAMPLE_POOL } from "./sample";

const LAST_POOL = "judge-ui:last-pool";
const EXPORT_NAME = "grades.tsv";
const gradesKey = (h: string) => `judge-ui:grades:${h}`;
const LABELS: Record<Grade, string> = { 0: "Not relevant", 1: "Partly", 2: "Relevant" };
const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Browser storage that cannot throw. A browser that blocks storage (cookies off, some private modes) throws on
 * the first touch, and the judge must still be able to grade and export. */
const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): boolean {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },
  drop(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      /* nothing was kept, so there is nothing to drop */
    }
  },
};

function loadGrades(h: string, inPool: (key: string) => boolean): Map<string, Grade> {
  try {
    const pairs = JSON.parse(store.get(gradesKey(h)) ?? "[]") as [string, Grade][];
    return new Map(pairs.filter(([k, g]) => (g === 0 || g === 1 || g === 2) && inPool(k)));
  } catch {
    return new Map();
  }
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/tab-separated-values" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** One line for the judge. "quiet" lines (one per grade) are read out by screen readers only: the pressed button
 * already shows them. The others are news, and are shown. */
type Note = { text: string; tone: "quiet" | "show" | "warn" };
const SILENT: Note = { text: "", tone: "quiet" };

export function App() {
  const [pool, setPool] = useState<Pool | null>(null);
  const [grades, setGrades] = useState<Map<string, Grade>>(new Map());
  const [index, setIndex] = useState(0);
  // Each grade given here, with what the document had before, so undo puts that back.
  const [history, setHistory] = useState<[string, Grade | undefined][]>([]);
  const [times, setTimes] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<Note>(SILENT);
  const [help, setHelp] = useState(false);
  const hasLast = useMemo(() => !!store.get(LAST_POOL), []);
  const where = useMemo(() => places(pool?.items ?? []), [pool]);

  const open = useCallback((text: string) => {
    try {
      const p = parsePool(text);
      if (!p.items.length) throw new Error("no documents to judge in this file");
      const at = places(p.items).at;
      const g = loadGrades(p.hash, (k) => at.has(k));
      setPool(p);
      setGrades(g);
      setHistory([]);
      setTimes([]);
      setIndex(Math.max(0, g.has(keyOf(p.items[0])) ? nextOpen(p.items, g, 0) : 0));
      setError(null);
      setNote(g.size ? { text: `Welcome back: ${count(g.size, "grade")} restored.`, tone: "show" } : SILENT);
      // Too big to keep, or the browser said no: then no older pool may pass for the last one either.
      if (text.length >= 3_000_000 || !store.set(LAST_POOL, text)) store.drop(LAST_POOL);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("sample")) open(SAMPLE_POOL);
  }, [open]);

  useEffect(() => {
    if (pool && !store.set(gradesKey(pool.hash), JSON.stringify([...grades]))) {
      setNote({ text: "The browser refused to save progress. Export before you close this tab.", tone: "warn" });
    }
  }, [pool, grades]);

  // Every key in `grades` is a document of this pool (open and import see to that), so the sizes say it all.
  const done = pool ? grades.size === pool.items.length : false;

  const grade = useCallback(
    (g: Grade) => {
      if (!pool) return;
      const k = keyOf(pool.items[index]);
      const next = new Map(grades).set(k, g);
      setGrades(next);
      setHistory((h) => [...h, [k, grades.get(k)]]);
      setTimes((t) => [...t, Date.now()]);
      const n = nextOpen(pool.items, next, index);
      if (n !== -1) setIndex(n);
      setNote({ text: `Graded ${LABELS[g].toLowerCase()}.`, tone: "quiet" });
    },
    [pool, grades, index],
  );

  const undo = useCallback(() => {
    if (!pool || !history.length) return;
    const [k, before] = history[history.length - 1];
    const next = new Map(grades);
    if (before === undefined) next.delete(k);
    else next.set(k, before);
    setGrades(next);
    setHistory(history.slice(0, -1));
    setTimes((t) => t.slice(0, -1));
    setIndex(where.at.get(k) ?? 0);
    setNote({ text: before === undefined ? "Last grade undone." : `Back to ${LABELS[before].toLowerCase()}.`, tone: "quiet" });
  }, [pool, grades, history, where]);

  const move = useCallback(
    (step: number) => pool && setIndex((i) => (i + step + pool.items.length) % pool.items.length),
    [pool],
  );

  const exportQrels = useCallback(() => {
    if (pool) download(EXPORT_NAME, toQrels(pool.items, grades));
  }, [pool, grades]);

  useEffect(() => {
    if (!pool) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const k = e.key;
      // A key held down repeats about 30 times a second. Moving that fast is fine; grading that fast is a run of
      // documents nobody read.
      if (e.repeat && k !== "ArrowRight" && k !== "ArrowLeft" && k !== "s") return;
      if (k === "0" || k === "1" || k === "2") grade(Number(k) as Grade);
      else if (k === "u" || k === "Backspace") undo();
      else if (k === "ArrowRight" || k === "s") move(1);
      else if (k === "ArrowLeft") move(-1);
      else if (k === "e") exportQrels();
      else if (k === "?") setHelp((h) => !h);
      else if (k === "Escape") setHelp(false);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pool, grade, undo, move, exportQrels]);

  const readFile = (input: HTMLInputElement | DataTransfer, then: (t: string) => void) => {
    const f = input.files?.[0];
    if (input instanceof HTMLInputElement) input.value = ""; // so choosing the same file again is a change again
    if (!f) return;
    const fail = (msg: string) => (pool ? setNote({ text: msg, tone: "warn" }) : setError(msg));
    if (f.size > LIMITS.bytes) return fail(`the file is larger than ${LIMITS.bytes / 1024 / 1024} MB`); // before reading: a huge file would freeze the tab first
    const r = new FileReader();
    r.onload = () => then(String(r.result ?? ""));
    r.onerror = () => fail("could not read that file");
    r.readAsText(f);
  };

  if (!pool) {
    return (
      <main className="start">
        <h1>judge-ui</h1>
        <p className="lead">Grade search results with the keyboard: 2 relevant, 1 partly, 0 not.</p>
        <label
          className="drop"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            readFile(e.dataTransfer, open);
          }}
        >
          <input type="file" accept=".jsonl,.json,.txt" onChange={(e) => readFile(e.target, open)} />
          <span>Drop a pool file here, or choose one</span>
          <small>JSON lines: query_id, query, doc_id, title, text</small>
        </label>
        <div className="row">
          <button onClick={() => open(SAMPLE_POOL)}>Try the sample</button>
          {hasLast && <button onClick={() => open(store.get(LAST_POOL) ?? "")}>Continue the last pool</button>}
        </div>
        {error && <p role="alert" className="error">{error}</p>}
        <p className="fine">Everything stays in this browser. Nothing is uploaded.</p>
      </main>
    );
  }

  const item = pool.items[index];
  const current = grades.get(keyOf(item));
  const query = where.queries.get(item.queryId)!;
  const speed = pace(times);
  const pct = Math.round((grades.size / pool.items.length) * 100);

  return (
    <main className="judge">
      <header>
        <strong>judge-ui</strong>
        <div
          className="bar"
          role="progressbar"
          aria-label="Graded"
          aria-valuemin={0}
          aria-valuemax={pool.items.length}
          aria-valuenow={grades.size}
        >
          <span style={{ width: `${pct}%` }} />
        </div>
        <span className="count">
          {grades.size} of {pool.items.length} graded{speed ? `, ${speed.toFixed(0)} a minute` : ""}
        </span>
      </header>

      {pool.problems.length > 0 && (
        <details className="problems">
          <summary>{count(pool.problems.length, "line")} skipped</summary>
          <ul>{pool.problems.slice(0, 20).map((p) => <li key={p}>{p}</li>)}</ul>
        </details>
      )}

      <section className="card" aria-labelledby="query">
        <p className="meta">
          Query {pool.queries > 1 ? `${query.n} of ${pool.queries}` : ""}
          {" "}· document {index - query.start + 1} of {query.size}
        </p>
        <h2 id="query">{item.query}</h2>
        <article>
          <h3>{item.title || <span className="muted">(no title)</span>}</h3>
          <p className="doc">{item.text || <span className="muted">(no text)</span>}</p>
          <p className="id">{item.docId}</p>
        </article>
      </section>

      <nav className="grades" aria-label="Grade this document">
        {([0, 1, 2] as Grade[]).map((g) => (
          <button
            key={g}
            className={`g${g}${current === g ? " on" : ""}`}
            aria-pressed={current === g}
            aria-keyshortcuts={String(g)}
            onClick={() => grade(g)}
          >
            <kbd>{g}</kbd> {LABELS[g]}
          </button>
        ))}
      </nav>

      <footer>
        <button onClick={() => move(-1)} aria-keyshortcuts="ArrowLeft">Back</button>
        <button onClick={() => move(1)} aria-keyshortcuts="ArrowRight s">Skip</button>
        <button onClick={undo} disabled={!history.length} aria-keyshortcuts="u">Undo</button>
        <button className="primary" onClick={exportQrels} aria-keyshortcuts="e">Export qrels</button>
        <label className="import">
          Import qrels
          <input
            type="file"
            accept=".tsv,.txt"
            onChange={(e) =>
              readFile(e.target, (t) => {
                const rows = [...parseQrels(t)];
                const mine = rows.filter(([k]) => where.at.has(k));
                const out = rows.length - mine.length;
                setGrades((old) => new Map([...old, ...mine]));
                setNote({
                  text: `${count(mine.length, "grade")} imported${out ? `, ${out} left out (not documents in this pool)` : ""}.`,
                  tone: "show",
                });
              })
            }
          />
        </label>
        <button onClick={() => setHelp((h) => !h)} aria-keyshortcuts="?">Keys</button>
      </footer>

      <p className={note.tone === "quiet" ? "live" : `notice ${note.tone}`} role="status">{note.text}</p>
      {done && (
        <p className="done">
          All {pool.items.length} graded. Export them (<kbd>e</kbd>). A first round is your <code>qrels/test.tsv</code>{" "}
          as it is. Add a later round with <code>relevance-gate judge --data your-folder --take {EXPORT_NAME}</code>,
          never by saving over the file: that would drop its earlier grades.
        </p>
      )}
      {help && (
        <aside className="help" aria-label="Keys">
          <p><kbd>2</kbd> relevant <kbd>1</kbd> partly <kbd>0</kbd> not</p>
          <p><kbd>→</kbd> or <kbd>s</kbd> skip, <kbd>←</kbd> back, <kbd>u</kbd> undo, <kbd>e</kbd> export</p>
        </aside>
      )}
    </main>
  );
}
