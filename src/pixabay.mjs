// Pixabay video and photo search. Pixabay asks for search results to be cached for
// 24 hours, so responses are kept in media/.cache/pixabay/ and reused across videos.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./env.mjs";

const env = loadEnv();
const CACHE_DIR = fileURLToPath(new URL("../media/.cache/pixabay/", import.meta.url));
const DAY_MS = 24 * 60 * 60 * 1000;
let pausedUntil = 0;

async function search(endpoint, params) {
  const query = new URLSearchParams({ safesearch: "true", per_page: "50", ...params });
  const cachePath = join(CACHE_DIR, `${createHash("sha256").update(endpoint + query).digest("hex").slice(0, 16)}.json`);
  if (existsSync(cachePath)) {
    const cached = JSON.parse(readFileSync(cachePath, "utf8"));
    if (Date.now() - cached.fetchedAt < DAY_MS) return cached.hits;
  }
  for (let attempt = 0; ; attempt++) {
    // The limit is 100 requests a minute; wait out the window when it runs low.
    if (Date.now() < pausedUntil) await sleep(pausedUntil - Date.now());
    const res = await fetch(`https://pixabay.com/api/${endpoint}?key=${encodeURIComponent(env.PIXABAY_API_KEY)}&${query}`);
    const reset = Number(res.headers.get("x-ratelimit-reset")) || 60;
    if (res.status === 429 || Number(res.headers.get("x-ratelimit-remaining")) <= 1) pausedUntil = Date.now() + reset * 1000;
    if (res.status === 429 && attempt < 2) continue;
    if (!res.ok) throw new Error(`Pixabay ${res.status} searching "${params.q}": ${(await res.text()).slice(0, 200)}`);
    const { hits } = await res.json();
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(cachePath, JSON.stringify({ query: params.q, fetchedAt: Date.now(), hits }));
    return hits;
  }
}

// Real footage only (no animation).
export const searchVideos = (q) => search("videos/", { q, video_type: "film" });
// Landscape photos (no illustrations). Without full API access, the largest
// downloadable size is 1,280 pixels wide.
export const searchPhotos = (q) => search("", { q, image_type: "photo", orientation: "horizontal" });

// Pixabay ranks by popularity and matches any of the words, so "empty parking lot
// aerial" returns popular forest drone shots. This is the share of the query's
// words found in a clip's tags ("lots" matches "parking lot").
export function tagScore(hit, query) {
  const tags = hit.tags.toLowerCase();
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return words.filter((w) => tags.includes(w.replace(/s$/, ""))).length / words.length;
}

// The smallest rendition at least `width` wide, or the largest there is.
export function rendition(hit, width = 1920) {
  const sizes = Object.values(hit.videos).filter((v) => v.url && v.size > 0).sort((a, b) => a.width - b.width);
  return sizes.find((v) => v.width >= width) ?? sizes.at(-1);
}
