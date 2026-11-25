// Aerial zooms: for each aerial scene, the camera flies down onto the real place,
// using the US government's aerial imagery (USDA's NAIP photos, served by USGS The
// National Map; public domain). Claude names the town and, when the scene is about
// one spot in it, the site (a mall, a road, a plant); both are looked up on
// OpenStreetMap. If the site can't be found, the zoom ends on the whole town, so it
// never circles the wrong building.
//
// The render needs sharp imagery from 50 km across down to about 1 km, so each zoom
// is a few images of the same spot at halving scales, each twice the frame in both
// directions. The render swaps to the next one as the camera passes it.
//
// A place the video comes back to gets a different move each time: the first visit
// flies down onto it, the second starts close and pulls back out, and later ones
// drift in slowly from close up.
//
// A scene whose site was built, torn down or emptied (scenes.json's `change`)
// shows the site from above the year before and the year after instead, wiping
// from one to the other (src/naip.mjs); if the site isn't on the map or wasn't
// photographed in those years, it gets the zoom.
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { ask, prompt } from "./claude.mjs";
import { USER_AGENT } from "./commons.mjs";
import { geocode } from "./geocode.mjs";
import { beforeAfter } from "./naip.mjs";

const EXPORT = "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/export";
const FRAME_W = 1920;
const IMAGE = [3840, 2160];
// How wide the last view is, in meters on the ground: a site fills about a third
// of it, a town most of it.
const SITE_VIEW = [1200, 4000];
const TOWN_VIEW = [3000, 12000];
// How wide the first view is.
const START_VIEW = [15000, 50000];
// A site further than this from its town is a different place with the same name.
const NEAR_KM = 25;
const EARTH_RADIUS = 6378137;

const Plan = z.object({
  aerials: z.array(
    z.object({
      scene: z.number().int(),
      place: z.object({ label: z.string(), query: z.string() }),
      site: z.object({ label: z.string(), query: z.string() }).nullable(),
    }),
  ),
});

const clamp = (x, [lo, hi]) => Math.min(hi, Math.max(lo, x));
const radians = (deg) => (deg * Math.PI) / 180;
// Web Mercator, the projection the imagery is served in.
const mercator = (lon, lat) => [radians(lon) * EARTH_RADIUS, Math.log(Math.tan(Math.PI / 4 + radians(lat) / 2)) * EARTH_RADIUS];
function kmBetween(a, b) {
  const h = Math.sin(radians(b.lat - a.lat) / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(radians(b.lon - a.lon) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

// The camera: where it looks, and how many Mercator units each screen pixel covers
// at the start and the end of the zoom.
function cameraFor(hit, isSite) {
  const [south, north, west, east] = hit.box;
  const groundW = radians(east - west) * EARTH_RADIUS * Math.cos(radians(hit.lat));
  const groundH = radians(north - south) * EARTH_RADIUS;
  const fit = Math.max(groundW, (groundH * 16) / 9);
  const endM = isSite ? clamp(fit * 3, SITE_VIEW) : clamp(fit * 1.15, TOWN_VIEW);
  const startM = clamp(endM * 10, START_VIEW);
  // Mercator stretches distances by 1/cos(latitude).
  const stretch = 1 / Math.cos(radians(hit.lat));
  const center = mercator(hit.lon, hit.lat);
  const [x0, y0] = mercator(west, south);
  const [x1, y1] = mercator(east, north);
  return {
    center,
    startMpp: (startM * stretch) / FRAME_W,
    endMpp: (endM * stretch) / FRAME_W,
    // The site's outline relative to the center, for the circle drawn around it.
    box: isSite ? [x0 - center[0], y0 - center[1], x1 - center[0], y1 - center[1]] : null,
  };
}

// The camera for a later visit to the same place: "out" starts close and pulls
// back to a wider view, "close" drifts in slowly from just above the last view.
function revisit(camera, visit) {
  if (visit === 0) return { ...camera, move: "in" };
  if (visit === 1) return { ...camera, move: "out", startMpp: camera.endMpp * 0.8, endMpp: camera.endMpp * 4 };
  return { ...camera, move: "close", startMpp: camera.endMpp * 1.6, endMpp: camera.endMpp * 0.8 };
}

// Images of the same spot at halving scales, from one that fills the widest view
// to one sharp at the closest. Returns [{ file, mpp, width, height }].
async function fetchLevels(dir, sceneId, camera) {
  const tag = createHash("sha256").update(JSON.stringify(camera)).digest("hex").slice(0, 8);
  const [widest, closest] = [Math.max(camera.startMpp, camera.endMpp), Math.min(camera.startMpp, camera.endMpp)];
  const levels = [];
  for (let i = 0; ; i++) {
    const mpp = widest / 2 ** (i + 1);
    const file = `footage/${sceneId}-usgs-${tag}-${i}.jpg`;
    if (!existsSync(join(dir, file))) {
      const [cx, cy] = camera.center;
      const [hw, hh] = [(IMAGE[0] / 2) * mpp, (IMAGE[1] / 2) * mpp];
      const params = new URLSearchParams({
        bbox: [cx - hw, cy - hh, cx + hw, cy + hh].join(","),
        bboxSR: "3857",
        imageSR: "3857",
        size: IMAGE.join(","),
        format: "jpg",
        f: "image",
      });
      const res = await fetch(`${EXPORT}?${params}`, { headers: { "User-Agent": USER_AGENT } });
      const type = res.headers.get("content-type") ?? "";
      if (!res.ok || !type.startsWith("image/")) throw new Error(`USGS imagery for scene ${sceneId}: HTTP ${res.status} ${type}`);
      writeFileSync(join(dir, file), Buffer.from(await res.arrayBuffer()));
    }
    levels.push({ file, mpp, width: IMAGE[0], height: IMAGE[1] });
    if (mpp <= closest) return levels;
  }
}

// Returns scene ID → an aerial pick for footage.json, or null where the place
// couldn't be found (that scene then looks for a photo instead).
export async function prepareAerials(video, dir, scenes) {
  const result = new Map();
  if (!scenes.length) return result;
  console.log(`Planning aerial zooms for ${scenes.length} scenes...`);
  const listing = scenes
    .map((s) =>
      [
        `## Scene ${s.id}`,
        `Place: ${s.place ?? "not given"}`,
        `On screen: ${s.visual}`,
        ...(s.change ? [`Shows the site before and after: ${s.change.before} and ${s.change.after ?? "today"}`] : []),
        `Narration: ${s.narration}`,
      ].join("\n"),
    )
    .join("\n\n");
  const reply = await ask({
    label: "aerial zooms",
    effort: "medium",
    maxTokens: 8000,
    system: "You plan aerial shots for a faceless YouTube channel of case studies on how the world really works.",
    user: prompt("aerial", { title: video.title, scenes: listing }),
    format: betaZodOutputFormat(Plan),
  });
  const plans = new Map(Plan.parse(JSON.parse(reply)).aerials.map((a) => [a.scene, a]));

  console.log("Fetching aerial imagery from USGS...");
  const visits = new Map();
  for (const scene of scenes) {
    const plan = plans.get(scene.id);
    const town = plan && (await geocode(plan.place.query));
    if (!town) {
      console.log(`  Scene ${scene.id}: couldn't find "${plan?.place.query ?? scene.place}"; it will look for a photo instead.`);
      result.set(scene.id, null);
      continue;
    }
    const spot = plan.site && (await geocode(plan.site.query));
    const site = spot && !/^boundary\//.test(spot.kind) && kmBetween(spot, town) <= NEAR_KM ? spot : null;
    if (plan.site && !site) console.log(`  Scene ${scene.id}: couldn't find "${plan.site.label}" on the map, so the zoom ends on ${plan.place.label}.`);
    const label = site ? plan.site.label : plan.place.label;
    const place = `${label}|${plan.place.label}`;
    const visit = visits.get(place) ?? 0;
    visits.set(place, visit + 1);
    const about = `${label}${site ? `, ${plan.place.label}` : ""}`;
    if (scene.change && site) {
      const shots = await beforeAfter(dir, scene.id, site, scene.change).catch((err) => ({ error: err.message }));
      if (!shots.error) {
        console.log(`  Scene ${scene.id}: ${label} in ${shots.before.year} and ${shots.after.year}`);
        result.set(scene.id, {
          id: `naip-${scene.id}`,
          source: "Microsoft Planetary Computer",
          kind: "change",
          about: `Aerial photos of ${about} in ${shots.before.year} and ${shots.after.year}`,
          title: "NAIP aerial imagery",
          author: "USDA NAIP, via Microsoft Planetary Computer",
          license: "Public domain",
          pageURL: "https://planetarycomputer.microsoft.com/dataset/naip",
          label,
          sublabel: plan.place.label,
          circle: !/^highway\//.test(site.kind),
          ...shots,
        });
        continue;
      }
      console.log(`  Scene ${scene.id}: no before and after of ${label}: ${shots.error}. It gets the zoom instead.`);
    } else if (scene.change) {
      console.log(`  Scene ${scene.id}: no before and after without the site on the map; it gets the zoom instead.`);
    }
    const camera = revisit(cameraFor(site ?? town, Boolean(site)), visit);
    const levels = await fetchLevels(dir, scene.id, camera);
    result.set(scene.id, {
      id: `usgs-${scene.id}`,
      source: "USGS The National Map",
      kind: "aerial",
      about: `Aerial imagery zooming onto ${about}`,
      title: "Aerial imagery",
      author: "USDA NAIP, via USGS The National Map",
      license: "Public domain",
      pageURL: "https://www.usgs.gov/programs/national-geospatial-program/national-map",
      label,
      sublabel: site ? plan.place.label : null,
      // Roads are long and thin: no circle around them.
      circle: Boolean(site) && !/^highway\//.test(site.kind),
      ...camera,
      levels,
    });
  }
  return result;
}
