// Coverr stock video search (https://api.coverr.co/docs/). Optional: used only
// when COVERR_API_KEY is in .env (a free key: coverr.co → Profile → API). The
// free Demo plan allows 50 requests an hour, so results are cached for a week in
// media/.cache/coverr/, the footage step makes one search per scene, and once the
// limit is hit the rest of the run carries on without Coverr.
//
// Coverr's license allows monetized videos; logos and trademarks that appear in a
// clip aren't licensed, and clips can't be claimed through Content ID. On the free
// plan, videos must be credited to Coverr, which the description's credits do.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./env.mjs";
import { slugify } from "./notion.mjs";

const env = loadEnv();
const CACHE_DIR = fileURLToPath(new URL("../media/.cache/coverr/", import.meta.url));
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
let stopped = false;

// Videos matching `q`, as Coverr's video objects with their download links, or []
// without a key or once Coverr has stopped answering for this run.
export async function searchCoverr(q) {
  if (!env.COVERR_API_KEY || stopped) return [];
  const query = new URLSearchParams({ query: q, page_size: "20", urls: "true" });
  const cachePath = join(CACHE_DIR, `${createHash("sha256").update(String(query)).digest("hex").slice(0, 16)}.json`);
  if (existsSync(cachePath)) {
    const cached = JSON.parse(readFileSync(cachePath, "utf8"));
    if (Date.now() - cached.fetchedAt < WEEK_MS) return cached.hits;
  }
  const res = await fetch(`https://api.coverr.co/videos?${query}`, { headers: { "x-api-key": env.COVERR_API_KEY } }).catch((err) => ({
    ok: false,
    status: err.cause?.code ?? err.name,
    text: async () => "",
  }));
  if (!res.ok) {
    // A missing source shouldn't stop the run: say why once and go on without it.
    stopped = true;
    const why = res.status === 429 ? "its hourly request limit was reached" : `it answered ${res.status} ${(await res.text()).slice(0, 120)}`;
    console.log(`  Coverr: ${why}; carrying on without it.`);
    return [];
  }
  const { hits = [] } = await res.json();
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(cachePath, JSON.stringify({ query: q, fetchedAt: Date.now(), hits }));
  return hits;
}

// The video's page on coverr.co: its title as a slug, then its ID in lower case.
export const coverrPage = (hit) => `https://coverr.co/videos/${hit.slug ?? `${slugify(hit.title)}-${hit.id.toLowerCase()}`}`;
