// Before and after from above: one site in two years of USDA's NAIP aerial photos
// (public domain), for an aerial scene whose site was built, torn down or emptied.
// USGS serves only the latest photos, so these come from Microsoft's Planetary
// Computer, which keeps every year since about 2010 (each state is flown every two
// or three years). The render wipes from the year before to the year after.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const STAC = "https://planetarycomputer.microsoft.com/api/stac/v1/search";
const RENDER = "https://planetarycomputer.microsoft.com/api/data/v1/item/bbox";
// The largest picture the Planetary Computer renders is 2048 wide.
const SIZE = [2048, 1152];
// How wide the view is on the ground, in meters: the site fills about half of it.
const VIEW = [800, 3000];
const METERS_PER_DEGREE = 111320;

const radians = (deg) => (deg * Math.PI) / 180;

// The view around a site from OpenStreetMap ({ lat, lon, box: [south, north,
// west, east] }), 16:9 on the ground, as [west, south, east, north] in degrees.
// Degrees of longitude shrink with latitude, so the box is wider in degrees than
// it is tall, and the picture comes out with square pixels.
export function viewAround(site) {
  const [south, north, west, east] = site.box;
  const cos = Math.cos(radians(site.lat));
  const groundW = (east - west) * METERS_PER_DEGREE * cos;
  const groundH = (north - south) * METERS_PER_DEGREE;
  const width = Math.min(VIEW[1], Math.max(VIEW[0], Math.max(groundW, (groundH * 16) / 9) * 2));
  const [cx, cy] = [(west + east) / 2, (south + north) / 2];
  const halfW = width / 2 / (METERS_PER_DEGREE * cos);
  const halfH = (width * 9) / 16 / 2 / METERS_PER_DEGREE;
  return [cx - halfW, cy - halfH, cx + halfW, cy + halfH];
}

// Every NAIP photo touching the view, by year: Map year → [{ id, bbox }].
async function photosByYear(view) {
  const [w, s, e, n] = view;
  const res = await fetch(STAC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ collections: ["naip"], intersects: { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] }, limit: 200 }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`the Planetary Computer's NAIP search answered ${res.status}`);
  const years = new Map();
  for (const f of (await res.json()).features ?? []) {
    const year = Number(f.properties["naip:year"] ?? f.properties.datetime?.slice(0, 4));
    years.set(year, [...(years.get(year) ?? []), { id: f.id, bbox: f.bbox }]);
  }
  return years;
}

// Whether a year's photos cover the whole view (checked on a grid of points), so
// the picture has no gaps at a state line or a photo that wasn't flown.
function covers(photos, [w, s, e, n]) {
  for (let i = 0; i <= 8; i++) {
    for (let j = 0; j <= 8; j++) {
      const [x, y] = [w + ((e - w) * i) / 8, s + ((n - s) * j) / 8];
      if (!photos.some(({ bbox: [a, b, c, d] }) => x >= a && x <= c && y >= b && y <= d)) return false;
    }
  }
  return true;
}

// The view in one year: each photo touching it rendered over the same box (clear
// outside its edges), laid over one another.
async function picture(path, view, photos) {
  const tmp = mkdtempSync(join(tmpdir(), "naip-"));
  try {
    const layers = [];
    for (const [i, { id }] of photos.entries()) {
      const params = new URLSearchParams({ collection: "naip", item: id, assets: "image", asset_bidx: "image|1,2,3" });
      const res = await fetch(`${RENDER}/${view.join(",")}/${SIZE.join("x")}.png?${params}`, { signal: AbortSignal.timeout(120000) });
      if (!res.ok) throw new Error(`the Planetary Computer couldn't draw NAIP photo ${id} (${res.status})`);
      const file = join(tmp, `${i}.png`);
      writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      layers.push(file);
    }
    const chain = layers.map((_, i) => `[${i === 0 ? "base" : `l${i}`}][${i}:v]overlay=format=auto[${i === layers.length - 1 ? "out" : `l${i + 1}`}]`).join(";");
    execFileSync(
      "ffmpeg",
      ["-y", "-v", "error", ...layers.flatMap((f) => ["-i", f]), "-filter_complex", `color=black:s=${SIZE.join("x")}[base];${chain}`, "-map", "[out]", "-frames:v", "1", "-q:v", "2", path],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// The site in the last year flown at or before `before`, and in the first year at
// or after `after` (or the latest, when it's null). Returns { before, after, site }
// with each picture's year and file, and the site's outline as shares of the
// picture's width and height; or { error }.
export async function beforeAfter(dir, sceneId, site, { before, after }) {
  const view = viewAround(site);
  const years = await photosByYear(view);
  const flown = [...years.keys()].filter((y) => covers(years.get(y), view)).sort((a, b) => a - b);
  const then = flown.filter((y) => y <= before).at(-1);
  const now = after ? (flown.find((y) => y >= after) ?? flown.at(-1)) : flown.at(-1);
  if (!then) return { error: `no NAIP photos of it from ${before} or earlier (flown: ${flown.join(", ") || "none"})` };
  if (!now || now <= then) return { error: `no NAIP photos of it after ${then} (flown: ${flown.join(", ")})` };
  const tag = createHash("sha256").update(JSON.stringify(view)).digest("hex").slice(0, 8);
  const shot = async (year) => {
    const file = `footage/${sceneId}-naip-${year}-${tag}.jpg`;
    if (!existsSync(join(dir, file))) await picture(join(dir, file), view, years.get(year));
    return { year, file };
  };
  const [w, s, e, n] = view;
  const [south, north, west, east] = site.box;
  return {
    before: await shot(then),
    after: await shot(now),
    width: SIZE[0],
    height: SIZE[1],
    site: { x0: (west - w) / (e - w), x1: (east - w) / (e - w), y0: (n - north) / (n - s), y1: (n - south) / (n - s) },
  };
}
