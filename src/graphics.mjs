// Structured data for a video's number, title and map scenes. Claude splits each
// number into a headline and label, picks a style for each title card, and turns
// each map's place description into places to look up. Places are geocoded with
// OpenStreetMap's Nominatim and projected onto the same US map the render draws.
// The result is cached in media/<slug>/graphics.json.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { geoAlbersUsa, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import { z } from "zod";
import { ask, prompt } from "./claude.mjs";
import { geocode } from "./geocode.mjs";

const us = createRequire(import.meta.url)("us-atlas/counties-albers-10m.json");
// The projection us-atlas's albers files were made with: the US on a 975×610 plane.
const project = geoAlbersUsa().scale(1300).translate([487.5, 305]);
const planar = geoPath();
const STATES = feature(us, us.objects.states).features;
const COUNTIES = feature(us, us.objects.counties).features;
// Smallest area a map zooms to, in map units (one is about 4.5 km): enough to show
// the counties around a town.
const MIN_BOX = 28;

const Graphics = z.object({
  numbers: z.array(
    z.object({
      scene: z.number().int(),
      headline: z.string(),
      label: z.string(),
      count: z.object({ to: z.number(), decimals: z.number().int(), prefix: z.string(), suffix: z.string() }).nullable(),
    }),
  ),
  titles: z.array(
    z.object({
      scene: z.number().int(),
      style: z.enum(["section", "statement", "quote", "question"]),
      text: z.string(),
      attribution: z.string().nullable(),
    }),
  ),
  maps: z.array(
    z.object({
      scene: z.number().int(),
      style: z.enum(["pins", "route", "region"]),
      places: z.array(z.object({ label: z.string(), query: z.string(), state: z.string(), county: z.string().nullable() })),
    }),
  ),
});

function findRegion(place) {
  const state = STATES.find((s) => s.properties.name.toLowerCase() === place.state.toLowerCase());
  const name = place.county?.replace(/\s+(county|parish|borough|census area)$/i, "").toLowerCase();
  const county = state && name ? COUNTIES.find((c) => c.id.startsWith(state.id) && c.properties.name.toLowerCase() === name) : null;
  return { state, county };
}

// Pins, highlighted states and counties, and the box the camera zooms to.
async function mapData(spec) {
  const points = [];
  const labels = [];
  const states = new Set();
  const counties = new Set();
  const boxes = [];
  for (const place of spec.places) {
    const { state, county } = findRegion(place);
    if (spec.style === "region") {
      const region = county ?? state;
      if (!region) continue;
      (county ? counties : states).add(region.id);
      boxes.push(planar.bounds(region));
      const [x, y] = planar.centroid(region);
      labels.push({ label: place.label, x, y });
      continue;
    }
    // A street address or business name can be too specific: drop the leading parts
    // until the place is found ("…, US 52, Kimball, …" → "Kimball, …").
    const parts = place.query.split(",").map((p) => p.trim());
    let at = null;
    for (let i = 0; !at && parts.length - i >= 2; i++) at = await geocode(parts.slice(i).join(", "));
    const xy = at && project([at.lon, at.lat]);
    if (!xy) continue;
    points.push({ label: place.label, x: xy[0], y: xy[1] });
    boxes.push([xy, xy]);
    if (state) states.add(state.id);
    if (county) counties.add(county.id);
  }
  if (!boxes.length) return null;
  let [x0, y0, x1, y1] = [
    Math.min(...boxes.map((b) => b[0][0])),
    Math.min(...boxes.map((b) => b[0][1])),
    Math.max(...boxes.map((b) => b[1][0])),
    Math.max(...boxes.map((b) => b[1][1])),
  ];
  // Pad around the places, and never zoom in further than MIN_BOX.
  const pad = Math.max(MIN_BOX - (x1 - x0), MIN_BOX - (y1 - y0), 0) / 2 + Math.max(x1 - x0, y1 - y0) * 0.25;
  [x0, y0, x1, y1] = [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
  // Labels go on the left of a pin when another pin is close on its right.
  for (const p of points) p.labelLeft = points.some((q) => q !== p && q.x > p.x && q.x - p.x < (x1 - x0) * 0.3 && Math.abs(q.y - p.y) < (y1 - y0) * 0.08);
  return { style: spec.style, points, labels, states: [...states], counties: [...counties], box: [x0, y0, x1, y1] };
}

// Returns scene ID → { number } | { title } | { map } for the scenes passed in.
export async function prepareGraphics(video, dir, numberScenes, titleScenes, mapScenes) {
  // Scenes are labelled by the graphic they need: aerial scenes without a photo become maps.
  // Title scenes marked standIn are footage scenes where nothing fit.
  const describe = (s, kind) =>
    [
      `## Scene ${s.id} (${s.standIn ? "title, standing in for footage" : kind})`,
      s.text && `Text: ${s.text}`,
      s.place && `Place: ${s.place}`,
      !s.standIn && `On screen: ${s.visual}`,
      `Narration: ${s.narration}`,
    ]
      .filter(Boolean)
      .join("\n");
  const listing = [
    ...numberScenes.map((s) => describe(s, "number")),
    ...titleScenes.map((s) => describe(s, "title")),
    ...mapScenes.map((s) => describe(s, "map")),
  ].join("\n\n");
  const key = createHash("sha256").update(listing).digest("hex");
  const cachePath = join(dir, "graphics.json");
  let plan = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, "utf8")) : null;
  if (plan?.key !== key) {
    console.log(`Preparing ${numberScenes.length} numbers, ${titleScenes.length} title cards and ${mapScenes.length} maps...`);
    const reply = await ask({
      label: "graphics",
      effort: "medium",
      maxTokens: 16000,
      system: prompt("channel"),
      user: prompt("graphics", { title: video.title, scenes: listing }),
      format: betaZodOutputFormat(Graphics),
    });
    plan = { key, ...Graphics.parse(JSON.parse(reply)) };
    writeFileSync(cachePath, `${JSON.stringify(plan, null, 2)}\n`);
  }
  const result = new Map();
  for (const n of plan.numbers) result.set(n.scene, { number: n });
  for (const t of plan.titles) result.set(t.scene, { title: t });
  // Map data is rebuilt each time (lookups are cached), so it follows code changes.
  for (const spec of plan.maps) {
    const map = await mapData(spec);
    if (map) result.set(spec.scene, { map });
    else console.log(`  Couldn't find the places for map scene ${spec.scene}; it will continue the previous shot.`);
  }
  return result;
}
