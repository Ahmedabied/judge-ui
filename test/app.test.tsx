import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { LIMITS, parsePool } from "../src/pool";
import { SAMPLE_POOL } from "../src/sample";

const key = (k: string) => act(() => void fireEvent.keyDown(window, { key: k }));
const graded = () => Number(screen.getByRole("progressbar").getAttribute("aria-valuenow"));
const shownDoc = () => screen.getByText(/^[a-z]\d$/).textContent;
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

  it("has no accessibility violations axe can find, on both screens", async () => {
    const { container } = render(<App />);
    const rules = { "color-contrast": { enabled: false } }; // jsdom cannot compute colours
    expect((await axe.run(container, { rules })).violations).toEqual([]);
    fireEvent.click(screen.getByText("Try the sample"));
    expect((await axe.run(container, { rules })).violations).toEqual([]);
  });
});
