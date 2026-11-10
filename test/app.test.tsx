import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { LIMITS, parsePool } from "../src/pool";
import { SAMPLE_POOL } from "../src/sample";

const key = (k: string) => act(() => void fireEvent.keyDown(window, { key: k }));
const graded = () => Number(screen.getByRole("progressbar").getAttribute("aria-valuenow"));
const shownDoc = () => screen.getByText(/^[a-z]\d$/).textContent;
/** The message a sighted judge can read (routine "Graded ..." lines are for screen readers only). */
const seen = () => document.querySelector(".notice")?.textContent ?? null;
const drop = async (file: File) => {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  await act(async () => {
    fireEvent.change(input, { target: { files: [file] } });
    await new Promise((r) => setTimeout(r, 30));
  });
};

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("judge-ui", () => {
  it("refuses a file over the size limit before reading any of it", async () => {
    render(<App />);
    const big = new File(["{}"], "big.jsonl");
    Object.defineProperty(big, "size", { value: LIMITS.bytes + 1 });
    const read = vi.spyOn(FileReader.prototype, "readAsText");
    await drop(big);
    expect(read).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/larger than 50 MB/);
    read.mockRestore();
  });

  it("grades with the keyboard and moves on", () => {
    render(<App />);
    fireEvent.click(screen.getByText("Try the sample"));
    const first = shownDoc();
    key("2");
    expect(graded()).toBe(1);
    expect(shownDoc()).not.toBe(first);
    key("0");
    key("1");
    expect(graded()).toBe(3);
    expect(screen.getByText(/3 of 15 graded/)).toBeTruthy();
  });

  it("opens the sample straight away with ?sample", () => {
    window.history.replaceState(null, "", "/?sample");
    render(<App />);
    expect(screen.getByRole("progressbar")).toBeTruthy();
    window.history.replaceState(null, "", "/");
  });

  it("undoes the last grade and goes back to it", () => {
    render(<App />);
    fireEvent.click(screen.getByText("Try the sample"));
    const first = shownDoc();
    key("2");
    key("u");
    expect(graded()).toBe(0);
    expect(shownDoc()).toBe(first);
  });

  it("skips and goes back without grading", () => {
    render(<App />);
    fireEvent.click(screen.getByText("Try the sample"));
    const first = shownDoc();
    key("ArrowRight");
    expect(shownDoc()).not.toBe(first);
    key("ArrowLeft");
    expect(shownDoc()).toBe(first);
    expect(graded()).toBe(0);
  });

  it("keeps progress in the browser and restores it", () => {
    const { unmount } = render(<App />);
    fireEvent.click(screen.getByText("Try the sample"));
    key("2");
    key("1");
    unmount();
    render(<App />);
    fireEvent.click(screen.getByText("Continue the last pool"));
    expect(graded()).toBe(2);
    expect(screen.getByText("Welcome back: 2 grades restored.")).toBeTruthy();
  });

  it("ignores keys with modifiers so browser shortcuts still work", () => {
    render(<App />);
    fireEvent.click(screen.getByText("Try the sample"));
    act(() => void fireEvent.keyDown(window, { key: "1", ctrlKey: true }));
    expect(graded()).toBe(0);
  });

  it("says when every document is graded", () => {
    render(<App />);
    fireEvent.click(screen.getByText("Try the sample"));
    for (let i = 0; i < parsePool(SAMPLE_POOL).items.length; i++) key("1");
    expect(screen.getByText(/All 15 graded/)).toBeTruthy();
  });

  it("shows document text as text, never as markup", async () => {
    render(<App />);
    const evil = JSON.stringify({ query_id: "q", query: "<b>q</b>", doc_id: "d1", title: "<img src=x onerror=alert(1)>", text: "<script>alert(1)</script>" });
    await drop(new File([evil], "pool.jsonl"));
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeTruthy();
    expect(screen.getByText("<script>alert(1)</script>")).toBeTruthy();
    expect(document.querySelector("main img, main script, main b")).toBeNull();
  });

  it("explains a file it cannot use", async () => {
    render(<App />);
    await drop(new File(["nothing useful"], "x.jsonl"));
    expect(screen.getByRole("alert").textContent).toBe("no documents to judge in this file");
  });

  it("undoing a changed grade brings the earlier grade back", () => {
    render(<App />);
    fireEvent.click(screen.getByText("Try the sample"));
    const first = shownDoc();
    key("2");
    key("ArrowLeft");
    expect(shownDoc()).toBe(first);
    key("0"); // changed my mind, then changed it back
    key("u");
    expect(shownDoc()).toBe(first);
    expect(graded()).toBe(1);
    expect(screen.getByRole("button", { name: "2 Relevant", pressed: true })).toBeTruthy();
    key("u");
    expect(graded()).toBe(0);
  });

  it("grades one document for a held key, not a run of them", () => {
    render(<App />);
    fireEvent.click(screen.getByText("Try the sample"));
    key("2");
    for (let i = 0; i < 5; i++) act(() => void fireEvent.keyDown(window, { key: "2", repeat: true }));
    expect(graded()).toBe(1);
    for (let i = 0; i < 5; i++) act(() => void fireEvent.keyDown(window, { key: "ArrowRight", repeat: true }));
    expect(graded()).toBe(1); // moving on a held arrow is fine
  });

  it("still works when the browser blocks storage, and says that progress is not saved", () => {
    const denied = () => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    };
    const spies = [vi.spyOn(Storage.prototype, "getItem"), vi.spyOn(Storage.prototype, "setItem"), vi.spyOn(Storage.prototype, "removeItem")];
    spies.forEach((spy) => spy.mockImplementation(denied));
    try {
      render(<App />);
      fireEvent.click(screen.getByText("Try the sample"));
      key("2");
      expect(graded()).toBe(1);
      expect(seen()).toMatch(/refused to save progress/);
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
  });

  it("shows what it restored where the judge can see it, until the next grade", () => {
    const { unmount } = render(<App />);
    fireEvent.click(screen.getByText("Try the sample"));
    key("2");
    unmount();
    render(<App />);
    fireEvent.click(screen.getByText("Continue the last pool"));
    expect(seen()).toBe("Welcome back: 1 grade restored.");
    key("1");
    expect(seen()).toBeNull(); // "Graded partly." is for screen readers; the pressed button already shows it
    expect(screen.getByRole("status").textContent).toBe("Graded partly.");
  });

  it("says how many imported grades were for documents that are not in the pool", async () => {
    render(<App />);
    fireEvent.click(screen.getByText("Try the sample"));
    const one = parsePool(SAMPLE_POOL).items[3];
    await drop(new File([`query-id\tcorpus-id\tscore\n${one.queryId}\t${one.docId}\t2\nq9\tgone\t1\nq9\tgone2\t0\n`], "old.tsv"));
    expect(graded()).toBe(1);
    expect(seen()).toBe("1 grade imported, 2 left out (not documents in this pool).");
  });

  it("does not offer an older pool as the last one after a pool too big to keep", async () => {
    const { unmount } = render(<App />);
    fireEvent.click(screen.getByText("Try the sample"));
    unmount();
    render(<App />);
    const big = JSON.stringify({ query_id: "q", query: "q", doc_id: "d1", text: "x".repeat(3_000_000) });
    await drop(new File([big], "big.jsonl"));
    expect(graded()).toBe(0);
    cleanup();
    render(<App />);
    expect(screen.queryByText("Continue the last pool")).toBeNull();
  });

  it("says where you are in the pool", () => {
    render(<App />);
    fireEvent.click(screen.getByText("Try the sample"));
    const items = parsePool(SAMPLE_POOL).items;
    expect(screen.getByText(/^Query 1 of 4/).textContent).toBe("Query 1 of 4 · document 1 of 4");
    for (let i = 0; i < 4; i++) key("ArrowRight");
    const inSecond = items.filter((i) => i.queryId === items[4].queryId).length;
    expect(screen.getByText(/^Query 2 of 4/).textContent).toBe(`Query 2 of 4 · document 1 of ${inSecond}`);
    key("ArrowLeft");
    expect(screen.getByText(/^Query 1 of 4/).textContent).toBe("Query 1 of 4 · document 4 of 4");
  });

  it("exports the grades as grades.tsv and says how they reach the qrels file", async () => {
    const blobs: Blob[] = [];
    const names: string[] = [];
    URL.createObjectURL = (b: Blob) => (blobs.push(b), "blob:x");
    URL.revokeObjectURL = () => {};
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });
    try {
      render(<App />);
      fireEvent.click(screen.getByText("Try the sample"));
      const items = parsePool(SAMPLE_POOL).items;
      for (let i = 0; i < items.length; i++) key("1");
      key("e");
      expect(names).toEqual(["grades.tsv"]);
      const text = await new Promise<string>((done) => {
        const r = new FileReader();
        r.onload = () => done(String(r.result));
        r.readAsText(blobs[0]);
      });
      expect(text).toBe("query-id\tcorpus-id\tscore\n" + items.map((i) => `${i.queryId}\t${i.docId}\t1\n`).join(""));
      expect(screen.getByText(/All 15 graded/).textContent).toMatch(/relevance-gate judge --data .* --take grades\.tsv/);
    } finally {
      click.mockRestore();
    }
  });

  it("has no accessibility violations axe can find, on both screens", async () => {
    const { container } = render(<App />);
    const rules = { "color-contrast": { enabled: false } }; // jsdom cannot compute colours
    expect((await axe.run(container, { rules })).violations).toEqual([]);
    fireEvent.click(screen.getByText("Try the sample"));
    expect((await axe.run(container, { rules })).violations).toEqual([]);
  });
});
