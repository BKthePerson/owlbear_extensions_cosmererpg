import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import { buildManifest } from "./manifest.ts";

// "/" for local dev. The Pages workflow sets BASE_PATH to "/<repo>/".
const base = process.env.BASE_PATH ?? "/";

// Serves manifest.json in dev and writes it into the build output, so there is
// one source for both.
function manifestPlugin(): Plugin {
  const json = `${JSON.stringify(buildManifest(base), null, 2)}\n`;
  return {
    name: "owlbear-manifest",
    configureServer(server) {
      server.middlewares.use("/manifest.json", (_req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.end(json);
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "manifest.json", source: json });
    },
  };
}

export default defineConfig({
  base,
  plugins: [manifestPlugin()],
  server: {
    port: 5173,
    // Owlbear fetches manifest.json from another origin, so allow it.
    cors: true,
    headers: { "Access-Control-Allow-Origin": "*" },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // The popover is the only page Vite processes. index.html (landing page)
    // and guide.html are static files in public/ and are copied as they are.
    rollupOptions: {
      input: fileURLToPath(new URL("./popover.html", import.meta.url)),
    },
  },
});
