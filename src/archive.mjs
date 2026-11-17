// Internet Archive search: old film from the Prelinger Archives (sponsored,
// educational and industrial films and TV ads, mostly 1930s–1970s), FedFlix (US
// government films) and Universal Newsreels (1929–1967). Only films the Archive
// marks public domain, CC0 or CC BY are used. Prelinger says plainly that many of
// its films without a Creative Commons mark are still under copyright.
import { fileURLToPath } from "node:url";
import { AGENT, cached } from "./commons.mjs";

const CACHE_DIR = fileURLToPath(new URL("../media/.cache/archive/", import.meta.url));
export const COLLECTIONS = { prelinger: "Prelinger Archives", FedFlix: "FedFlix", universal_newsreels: "Universal Newsreels" };
// Films looked up per search. Each lookup lists the film's files.
const PER_SEARCH = 8;
// Longer films have no copy small enough to preview (see src/shots.mjs).
const MAX_SECONDS = 1200;
// Video encodings worth previewing or cutting from. A FedFlix film's sharpest copy
// is often its MPEG-2 original.
const FORMATS = /^(h\.264( HD)?|MPEG4|512Kb MPEG4|Ogg Video|MPEG2)$/;

const get = async (url) => {
  const res = await fetch(url, { headers: { "User-Agent": AGENT } });
  if (!res.ok) throw new Error(`Internet Archive ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
};

// A license name, or null for one that rules out a monetized video (non-commercial
// or no derivatives).
function licenseName(url = "") {
  if (/publicdomain\/zero/.test(url)) return "CC0";
  if (/publicdomain/.test(url)) return "Public domain";
  const m = url.match(/licenses\/(by|by-sa)\/([\d.]+)/);
  return m ? `CC ${m[1].toUpperCase()} ${m[2]}` : null;
}

// "854.02", "14:21" or "1:02:03" in seconds.
const seconds = (length = "") => String(length).split(":").reduce((total, part) => total * 60 + Number(part), 0);
const plainText = (text = "") => [text].flat().join(" ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

// Landscape films 4 seconds to 20 minutes long matching `query` (in their title,
// description, subjects or reviews), most relevant first, with the encodings the
// Archive serves.
export async function searchArchive(query) {
  const cache = cached(CACHE_DIR, "films", query);
  if (cache.results) return cache.results;
  const words = query.replace(/[^\p{L}\p{N}\s'-]/gu, " ").trim();
  if (!words) return cache.save([]);
  const params = new URLSearchParams({
    q: `(${words}) AND collection:(${Object.keys(COLLECTIONS).join(" OR ")}) AND mediatype:movies AND licenseurl:*`,
    rows: "30",
    output: "json",
  });
  for (const field of ["identifier", "licenseurl"]) params.append("fl[]", field);
  const hits = (await get(`https://archive.org/advancedsearch.php?${params}`)).response.docs.filter((d) => licenseName(d.licenseurl)).slice(0, PER_SEARCH);
  const films = await Promise.all(
    hits.map(async ({ identifier, licenseurl }) => {
      const { metadata: m = {}, files = [] } = await get(`https://archive.org/metadata/${identifier}`).catch(() => ({}));
      const encodings = files
        .filter((f) => FORMATS.test(f.format) && Number(f.width) > 0 && Number(f.height) > 0)
        .map((f) => ({ width: Number(f.width), height: Number(f.height), url: `https://archive.org/download/${identifier}/${encodeURIComponent(f.name)}`, original: f.source === "original", length: seconds(f.length) }))
        // Smallest first; at the same size, the original last, since it's the sharpest
        // to cut a clip from (src/shots.mjs previews the first and cuts from the last).
        .sort((a, b) => a.width - b.width || a.original - b.original);
      const best = encodings.at(-1);
      const duration = Math.max(...encodings.map((e) => e.length));
      if (!best || best.width <= best.height || best.width < 320 || !(duration >= 4 && duration <= MAX_SECONDS)) return [];
      const collection = [m.collection].flat().find((c) => COLLECTIONS[c]);
      return [
        {
          identifier,
          title: plainText(m.title) || identifier,
          year: Number(String(m.year ?? m.date ?? "").match(/\d{4}/)?.[0]) || null,
          collection: COLLECTIONS[collection] ?? "Internet Archive",
          description: plainText(m.description).slice(0, 400),
          pageURL: `https://archive.org/details/${identifier}`,
          author: plainText(m.creator || m.sponsor) || COLLECTIONS[collection] || "unknown",
          license: licenseName(licenseurl),
          width: best.width,
          height: best.height,
          duration,
          encodings: encodings.map(({ width, height, url }) => ({ width, height, url })),
        },
      ];
    }),
  );
  return cache.save(films.flat());
}
