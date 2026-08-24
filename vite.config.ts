import { defineConfig, type Plugin } from "vite";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

// One shared codebase, one manifest/base.json, and a small per-browser
// overlay (manifest/chrome.json, manifest/firefox.json) merged at build
// time. Select with TARGET=chrome (default) or TARGET=firefox.
const target = process.env.TARGET === "firefox" ? "firefox" : "chrome";

function manifestPlugin(): Plugin {
  return {
    name: "logbook-manifest",
    generateBundle() {
      const read = (name: string) =>
        JSON.parse(readFileSync(resolve(__dirname, "manifest", name), "utf8"));
      const manifest = { ...read("base.json"), ...read(`${target}.json`) };
      this.emitFile({
        type: "asset",
        fileName: "manifest.json",
        source: JSON.stringify(manifest, null, 2) + "\n",
      });
    },
  };
}

export default defineConfig({
  plugins: [manifestPlugin()],
  build: {
    outDir: `dist/${target}`,
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: resolve(__dirname, "src/background.ts"),
        popup: resolve(__dirname, "popup.html"),
        dashboard: resolve(__dirname, "dashboard.html"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
});
