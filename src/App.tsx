import { useCallback, useEffect, useMemo, useState } from "react";
import { type Grade, type Pool, keyOf, nextOpen, pace, parsePool, parseQrels, toQrels } from "./pool";
import { SAMPLE_POOL } from "./sample";

const LAST_POOL = "judge-ui:last-pool";
const gradesKey = (h: string) => `judge-ui:grades:${h}`;
const LABELS: Record<Grade, string> = { 0: "Not relevant", 1: "Partly", 2: "Relevant" };

function loadGrades(h: string): Map<string, Grade> {
  try {
    const raw = localStorage.getItem(gradesKey(h));
    const pairs = raw ? (JSON.parse(raw) as [string, Grade][]) : [];
    return new Map(pairs.filter(([, g]) => g === 0 || g === 1 || g === 2));
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

export function App() {
  const [pool, setPool] = useState<Pool | null>(null);
  const [grades, setGrades] = useState<Map<string, Grade>>(new Map());
  const [index, setIndex] = useState(0);
  const [history, setHistory] = useState<string[]>([]);
  const [times, setTimes] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [help, setHelp] = useState(false);
  const hasLast = useMemo(() => !!localStorage.getItem(LAST_POOL), []);

  const open = useCallback((text: string) => {
    try {
      const p = parsePool(text);
      if (!p.items.length) throw new Error("no documents to judge in this file");
      const g = loadGrades(p.hash);
      setPool(p);
      setGrades(g);
      setHistory([]);
      setTimes([]);
      setIndex(Math.max(0, g.has(keyOf(p.items[0])) ? nextOpen(p.items, g, 0) : 0));
      setError(null);
      setNote(g.size ? `Welcome back: ${g.size} grades restored.` : "");
      try {
        if (text.length < 3_000_000) localStorage.setItem(LAST_POOL, text);
      } catch {
        /* storage full: the pool still works, it just will not reopen by itself */
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("sample")) open(SAMPLE_POOL);
  }, [open]);

  useEffect(() => {
    if (!pool) return;
    try {
      localStorage.setItem(gradesKey(pool.hash), JSON.stringify([...grades]));
    } catch {
      setNote("The browser refused to save progress. Export now to keep your grades.");
    }
  }, [pool, grades]);

  const done = pool ? nextOpen(pool.items, grades, index) === -1 && grades.has(keyOf(pool.items[index])) : false;

  const grade = useCallback(
    (g: Grade) => {
      if (!pool) return;
      const k = keyOf(pool.items[index]);
      const next = new Map(grades).set(k, g);
      setGrades(next);
      setHistory((h) => [...h, k]);
      setTimes((t) => [...t, Date.now()]);
      const n = nextOpen(pool.items, next, index);
      if (n !== -1) setIndex(n);
      setNote(`Graded ${LABELS[g].toLowerCase()}.`);
    },
    [pool, grades, index],
  );

  const undo = useCallback(() => {
    if (!pool || !history.length) return;
    const k = history[history.length - 1];
    const next = new Map(grades);
    next.delete(k);
    setGrades(next);
    setHistory(history.slice(0, -1));
    setIndex(pool.items.findIndex((i) => keyOf(i) === k));
    setNote("Last grade undone.");
  }, [pool, grades, history]);

  const move = useCallback(
    (step: number) => pool && setIndex((i) => (i + step + pool.items.length) % pool.items.length),
    [pool],
  );

  const exportQrels = useCallback(() => {
    if (pool) download("test.tsv", toQrels(pool.items, grades));
  }, [pool, grades]);

  useEffect(() => {
    if (!pool) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const k = e.key;
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

  const readFile = (f: File | undefined, then: (t: string) => void) => {
    if (!f) return;
    const r = new FileReader();
    r.onload = () => then(String(r.result ?? ""));
    r.onerror = () => setError("could not read that file");
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
            readFile(e.dataTransfer.files[0], open);
          }}
        >
          <input type="file" accept=".jsonl,.json,.txt" onChange={(e) => readFile(e.target.files?.[0], open)} />
          <span>Drop a pool file here, or choose one</span>
          <small>JSON lines: query_id, query, doc_id, title, text</small>
        </label>
        <div className="row">
          <button onClick={() => open(SAMPLE_POOL)}>Try the sample</button>
          {hasLast && <button onClick={() => open(localStorage.getItem(LAST_POOL) ?? "")}>Continue the last pool</button>}
        </div>
        {error && <p role="alert" className="error">{error}</p>}
        <p className="fine">Everything stays in this browser. Nothing is uploaded.</p>
      </main>
    );
  }

  const item = pool.items[index];
  const current = grades.get(keyOf(item));
  const inQuery = pool.items.filter((i) => i.queryId === item.queryId);
  const posInQuery = inQuery.indexOf(item) + 1;
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
          <summary>{pool.problems.length} lines skipped</summary>
          <ul>{pool.problems.slice(0, 20).map((p) => <li key={p}>{p}</li>)}</ul>
        </details>
      )}

      <section className="card" aria-labelledby="query">
        <p className="meta">
          Query {pool.queries > 1 ? `${[...new Set(pool.items.map((i) => i.queryId))].indexOf(item.queryId) + 1} of ${pool.queries}` : ""}
          {" "}· document {posInQuery} of {inQuery.length}
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
              readFile(e.target.files?.[0], (t) => {
                const add = parseQrels(t);
                const known = new Set(pool.items.map(keyOf));
                const merged = new Map(grades);
                let n = 0;
                for (const [k, g] of add) if (known.has(k)) merged.set(k, g), n++;
                setGrades(merged);
                setNote(`${n} grades imported.`);
              })
            }
          />
        </label>
        <button onClick={() => setHelp((h) => !h)} aria-keyshortcuts="?">Keys</button>
      </footer>

      {done && <p className="done">All {pool.items.length} graded. Export the qrels and put them in your data folder as qrels/test.tsv.</p>}
      {help && (
        <aside className="help" aria-label="Keys">
          <p><kbd>2</kbd> relevant <kbd>1</kbd> partly <kbd>0</kbd> not</p>
          <p><kbd>→</kbd> or <kbd>s</kbd> skip, <kbd>←</kbd> back, <kbd>u</kbd> undo, <kbd>e</kbd> export</p>
        </aside>
      )}
      <p className="live" aria-live="polite">{note}</p>
    </main>
  );
}
