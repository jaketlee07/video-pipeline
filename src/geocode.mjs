// Where a US place is and how big it is, from OpenStreetMap's Nominatim. It allows
// one request a second and asks for results to be cached, so every lookup is kept
// in media/.cache/geocode.json.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { USER_AGENT } from "./commons.mjs";

const CACHE = fileURLToPath(new URL("../media/.cache/geocode.json", import.meta.url));
let lastLookup = 0;

// { lat, lon, box: [south, north, west, east], kind: "shop/mall", name } or null.
// Older cache entries have no box, so they're looked up again.
export async function geocode(query) {
  const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {};
  if (query in cache && (cache[query] === null || cache[query].box)) return cache[query];
  const wait = lastLookup + 1100 - Date.now();
  if (wait > 0) await sleep(wait);
  lastLookup = Date.now();
  const params = new URLSearchParams({ q: query, format: "jsonv2", limit: "1", countrycodes: "us" });
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Nominatim ${res.status} looking up "${query}"`);
  const [hit] = await res.json();
  cache[query] = hit
    ? { lat: Number(hit.lat), lon: Number(hit.lon), box: hit.boundingbox.map(Number), kind: `${hit.category}/${hit.type}`, name: hit.name }
    : null;
  mkdirSync(dirname(CACHE), { recursive: true });
  writeFileSync(CACHE, `${JSON.stringify(cache, null, 2)}\n`);
  return cache[query];
}
