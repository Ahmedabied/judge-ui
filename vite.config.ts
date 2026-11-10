/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: { target: "es2022", sourcemap: false },
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.{ts,tsx}"],
    // Node 25+ has its own localStorage global, undefined without --localstorage-file, and it hides jsdom's.
    // The app runs in a browser, so the tests turn Node's off and use jsdom's, as the browser would.
    execArgv: ["--no-experimental-webstorage"],
  },
});
