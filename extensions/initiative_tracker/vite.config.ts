import { defineConfig } from "vite";

// Relative base so the build works from a GitHub Pages project path
// (https://<user>.github.io/<repo>/) as well as from localhost.
export default defineConfig({
  base: "./",
  server: {
    port: 5173,
    // Owlbear fetches manifest.json from another origin, so allow it.
    cors: true,
    headers: { "Access-Control-Allow-Origin": "*" },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
