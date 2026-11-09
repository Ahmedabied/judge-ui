/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: { target: "es2022", sourcemap: false },
  test: { environment: "jsdom", include: ["test/**/*.test.{ts,tsx}"] },
});
