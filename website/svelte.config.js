import adapter from "@sveltejs/adapter-vercel";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  extensions: [".svelte"],
  preprocess: [
    vitePreprocess(),
  ],
  kit: {
    // Vercel: static pages prerender to CDN, chapter routes render on demand
    // via the Postgres-backed API (see src/routes/api/ + read/[book]/[tl]/[slug]).
    adapter: adapter({
      runtime: "nodejs22.x",
    }),

    prerender: {
      concurrency: 5,
      crawl: true,
      handleHttpError: "warn",
    },

    alias: {
      $lib: "./src/lib",
    },
  },
};

export default config;
