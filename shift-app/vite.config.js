import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  // デモ版（1ファイルで配布）はロゴなどの画像を埋め込む
  build: process.env.VITE_DEMO ? { assetsInlineLimit: 200000 } : {},
});
