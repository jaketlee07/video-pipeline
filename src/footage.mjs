// Footage (guide stages 6 and 7): for every stock, image and aerial scene, gathers
// candidates from Pixabay (videos and photos) and Wikimedia Commons (real photos of
// the places and companies named), has Claude pick the best from a still of each,
// and downloads the pick to media/<slug>/footage/. Photos get a slow pan and zoom in
// the render. footage.json lists each pick with its runners-up, plus the credits
// for the video description. Scenes where nothing fits get a graphic instead.
//
//   npm run footage                     the row with Status "Approved"
//   npm run footage -- walmart          the row with "walmart" in its title
//
// Scenes already in footage.json are kept. To swap a pick, copy one of the scene's
// alternates into its "pick" and run this again; to re-pick from scratch, delete the
// scene's entry.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { ask, prompt, totalSpent } from "./claude.mjs";
import { USER_AGENT, photoURL, searchCommons } from "./commons.mjs";
import { findVideo } from "./notion.mjs";
import { videoDir } from "./paths.mjs";
import { rendition, searchPhotos, searchVideos, tagScore } from "./pixabay.mjs";

const args = process.argv.slice(2);
const force = args.includes("--force");
const query = args.filter((a) => !a.startsWith("--")).join(" ") || undefined;

const FOOTAGE_TYPES = ["stock", "image", "aerial"];
// Most candidates per scene from each source. Aerial scenes only use Commons: stock
// drone shots can't show the actual place.
const PER_SCENE = { video: 4, pixabayPhoto: 2, commons: 3, aerialCommons: 5 };
const PER_QUERY = 2;
const PER_UPLOADER = 2;
const MIN_TAG_SCORE = 0.5;
const SCENES_PER_CALL = 8;
// A clip can be slowed to fill a slightly longer scene.
const MIN_LENGTH_SHARE = 0.75;
const SYSTEM = "You choose footage for a faceless YouTube channel about the hidden economics of everyday things.";

const Picks = z.object({
  picks: z.array(z.object({ scene: z.number().int(), candidate: z.number().int().describe("Candidate number, or 0 if none fit") })),
});
const Searches = z.object({ scenes: z.array(z.object({ scene: z.number().int(), queries: z.array(z.string()) })) });

// Runs `fn` over `items`, `size` at a time.
async function inGroups(items, size, fn) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}

// A still shrunk to 480 pixels wide (about 190 tokens instead of 1,200), or null if
// it can't be fetched or read. It goes through a temp file: piping it into ffmpeg
// can deadlock.
let stills = 0;
async function still(url) {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } }).catch(() => null);
  if (!res?.ok) return null;
  const source = join(tmpdir(), `video-pipeline-still-${process.pid}-${stills++}`);
  writeFileSync(source, Buffer.from(await res.arrayBuffer()));
  try {
    const args = ["-v", "error", "-nostdin", "-i", source, "-vf", "scale=480:-2", "-frames:v", "1", "-f", "image2", "-c:v", "mjpeg", "-q:v", "4", "-"];
    return execFileSync("ffmpeg", args, { timeout: 30_000, stdio: ["ignore", "pipe", "ignore"] }).toString("base64");
  } catch {
    return null;
  } finally {
    rmSync(source, { force: true });
  }
}

const sceneKey = (scene) => JSON.stringify([scene.visual, scene.search]);

// Pixabay hits whose tags match the query, best matches first.
const byTags = (hits, q) =>
  hits
    .map((hit) => ({ hit, score: tagScore(hit, q) }))
    .filter((m) => m.score >= MIN_TAG_SCORE)
    .sort((a, b) => b.score - a.score)
    .map((m) => m.hit);

const PIXABAY_LICENSE = "Pixabay Content License";
function fromVideo(hit, query) {
  const v = rendition(hit);
  return {
    id: String(hit.id),
    source: "Pixabay",
    kind: "video",
    about: `${hit.duration} seconds. Tags: ${hit.tags}`,
    pageURL: hit.pageURL,
    author: hit.user,
    license: PIXABAY_LICENSE,
    duration: hit.duration,
    width: v.width,
    height: v.height,
    url: v.url,
    thumbnail: hit.videos.tiny.thumbnail,
    query,
  };
}
const fromPixabayPhoto = (hit, query) => ({
  id: `p${hit.id}`,
  source: "Pixabay",
  kind: "photo",
  about: `Tags: ${hit.tags}`,
  pageURL: hit.pageURL,
  author: hit.user,
  license: PIXABAY_LICENSE,
  width: 1280,
  height: Math.round((1280 * hit.imageHeight) / hit.imageWidth),
  url: hit.largeImageURL,
  thumbnail: hit.webformatURL,
  query,
});
const fromCommons = (photo, query) => ({
  id: `c${photo.pageid}`,
  source: "Wikimedia Commons",
  kind: "photo",
  about: `Title: ${photo.title}`,
  title: photo.title,
  pageURL: photo.pageURL,
  author: photo.author,
  license: photo.license,
  width: photo.width,
  height: photo.height,
  thumbnail: photo.thumbnail,
  query,
});

// Asks Claude for searches, scene by scene. Returns scene ID → queries.
async function suggestSearches(label, promptName, title, scenes, tried = new Map()) {
  const list = scenes
    .map((s) => {
      const lines = [`## Scene ${s.id} (${s.type})`, `On screen: ${s.visual}`, `Narration: ${s.narration}`];
      if (s.place) lines.push(`Place: ${s.place}`);
      if (tried.has(s.id)) lines.push(`Already searched: ${tried.get(s.id).join(" | ")}`);
      return lines.join("\n");
    })
    .join("\n\n");
  const reply = await ask({
    label,
    effort: "medium",
    maxTokens: 16000,
    system: SYSTEM,
    user: prompt(promptName, { title, scenes: list }),
    format: betaZodOutputFormat(Searches),
  });
  return new Map(Searches.parse(JSON.parse(reply)).scenes.map((s) => [s.scene, s.queries.slice(0, 3)]));
}

// Claude picks each scene's footage from a still of every candidate. Returns scene
// ID → the chosen candidate, or null where none fit.
async function pickFootage(title, scenes, candidates) {
  const chosen = new Map();
  const choosable = scenes.filter((s) => candidates.get(s.id).length);
  if (!choosable.length) return chosen;
  console.log(`Choosing footage for ${choosable.length} scenes...`);
  const groups = [];
  for (let i = 0; i < choosable.length; i += SCENES_PER_CALL) groups.push(choosable.slice(i, i + SCENES_PER_CALL));
  await inGroups(groups, 3, async (group) => {
    const content = [{ type: "text", text: prompt("footage", { title }) }];
    const shown = new Map();
    for (const scene of group) {
      const place = scene.place ? `\nPlace: ${scene.place}` : "";
      content.push({ type: "text", text: `\n## Scene ${scene.id} (${scene.type}, ${scene.seconds} seconds)\nOn screen: ${scene.visual}${place}\nNarration: ${scene.narration}` });
      const list = [];
      for (const c of candidates.get(scene.id)) {
        const image = await still(c.thumbnail);
        if (!image) continue;
        list.push(c);
        content.push({ type: "text", text: `Candidate ${list.length}: ${c.kind} from ${c.source}, ${c.about}` });
        content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } });
      }
      shown.set(scene.id, list);
    }
    const reply = await ask({
      label: `footage, scenes ${group[0].id}-${group.at(-1).id}`,
      effort: "medium",
      maxTokens: 16000,
      system: SYSTEM,
      user: content,
      format: betaZodOutputFormat(Picks),
    });
    for (const { scene, candidate } of Picks.parse(JSON.parse(reply)).picks) {
      chosen.set(scene, shown.get(scene)?.[candidate - 1] ?? null);
    }
  });
  return chosen;
}

async function main() {
  const video = await findVideo(query, "Approved");
  if (video.status !== "Approved" && !force) {
    throw new Error(`"${video.title}" is "${video.status}", not "Approved". Approve the script in Notion first, or add --force.`);
  }
  const dir = videoDir(video.slug);
  const planPath = join(dir, "scenes.json");
  if (!existsSync(planPath)) throw new Error(`"${video.title}" has no scenes yet. Run npm run scenes first.`);
  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  // Real scene lengths once the narration exists, estimates before.
  const timingPath = join(dir, "timing.json");
  const timed = existsSync(timingPath) ? new Map(JSON.parse(readFileSync(timingPath, "utf8")).scenes.map((s) => [s.id, s.end - s.start])) : new Map();
  const footageDir = join(dir, "footage");
  mkdirSync(footageDir, { recursive: true });
  const footagePath = join(dir, "footage.json");
  const previous = existsSync(footagePath) ? JSON.parse(readFileSync(footagePath, "utf8")).scenes : [];

  const scenes = plan.scenes
    .filter((s) => FOOTAGE_TYPES.includes(s.type))
    .map((s) => ({ ...s, seconds: Math.round((timed.get(s.id) ?? s.estSeconds) * 10) / 10 }));
  const kept = new Map();
  for (const entry of previous) {
    const scene = scenes.find((s) => s.id === entry.id);
    if (scene && entry.key === sceneKey(scene)) kept.set(scene.id, entry);
  }
  const todo = scenes.filter((s) => !kept.has(s.id));
  console.log(`Footage for "${video.title}": ${scenes.length} scenes${kept.size ? ` (${kept.size} already picked)` : ""}.`);

  // Each candidate goes to one scene only, and each uploader gets at most two slots
  // per scene, since popular results are often one shoot.
  const taken = new Set([...kept.values()].flatMap((e) => [e.pick, ...e.alternates].filter(Boolean).map((c) => c.id)));
  async function gather(scene, pixabayQueries, commonsQueries) {
    const found = { video: [], pixabayPhoto: [], commons: [] };
    const add = (bucket, limit, candidate) => {
      const list = found[bucket];
      const sameAuthor = list.filter((c) => c.author === candidate.author).length;
      if (list.length >= limit || taken.has(candidate.id) || sameAuthor >= PER_UPLOADER) return false;
      list.push(candidate);
      taken.add(candidate.id);
      return true;
    };
    const take = (bucket, limit, items) => {
      let added = 0;
      for (const item of items) if (added < PER_QUERY && add(bucket, limit, item)) added++;
    };
    const commonsLimit = scene.type === "aerial" ? PER_SCENE.aerialCommons : PER_SCENE.commons;
    for (const q of commonsQueries) take("commons", commonsLimit, (await searchCommons(q)).map((p) => fromCommons(p, q)));
    if (scene.type !== "aerial") {
      for (const q of pixabayQueries) {
        const videos = (await searchVideos(q)).filter((h) => {
          const v = rendition(h);
          return v && v.width > v.height && v.width >= 1280 && !h.isAiGenerated && !h.isLowQuality && h.duration >= scene.seconds * MIN_LENGTH_SHARE;
        });
        take("video", PER_SCENE.video, byTags(videos, q).map((h) => fromVideo(h, q)));
        const photos = (await searchPhotos(q)).filter((h) => h.imageWidth > h.imageHeight && h.imageWidth >= 1920 && !h.isAiGenerated);
        take("pixabayPhoto", PER_SCENE.pixabayPhoto, byTags(photos, q).map((h) => fromPixabayPhoto(h, q)));
      }
    }
    return [...found.video, ...found.commons, ...found.pixabayPhoto];
  }

  const candidates = new Map();
  if (todo.length) {
    console.log(`Planning Wikimedia Commons searches for ${todo.length} scenes...`);
    const commonsQueries = await suggestSearches("commons searches", "commons", video.title, todo);
    console.log("Searching Pixabay and Wikimedia Commons...");
    for (const scene of todo) candidates.set(scene.id, await gather(scene, scene.search, commonsQueries.get(scene.id) ?? []));
  }
  const chosen = await pickFootage(video.title, todo, candidates);

  // Where nothing fit, search again with simpler words, as an editor would.
  const retry = todo.filter((s) => !chosen.get(s.id));
  if (retry.length) {
    console.log(`Nothing fit for ${retry.length} scenes; searching again with simpler words...`);
    const tried = new Map(retry.map((s) => [s.id, [...new Set([...s.search, ...candidates.get(s.id).map((c) => c.query)])]]));
    const queries = await suggestSearches("new searches", "requery", video.title, retry, tried);
    const more = new Map();
    for (const scene of retry) more.set(scene.id, await gather(scene, queries.get(scene.id) ?? [], queries.get(scene.id) ?? []));
    for (const [id, pick] of await pickFootage(video.title, retry, more)) chosen.set(id, pick);
    for (const scene of retry) candidates.set(scene.id, [...candidates.get(scene.id), ...more.get(scene.id)]);
  }

  // Download the picks, including any swapped in by hand.
  const entries = new Map(kept);
  for (const scene of todo) {
    const pick = chosen.get(scene.id) ?? null;
    entries.set(scene.id, {
      id: scene.id,
      type: scene.type,
      seconds: scene.seconds,
      key: sceneKey(scene),
      pick,
      alternates: candidates.get(scene.id).filter((c) => c !== pick),
    });
  }
  for (const { id, pick } of entries.values()) {
    if (!pick) continue;
    const ext = pick.kind === "video" ? ".mp4" : extname(pick.title ?? new URL(pick.url).pathname).toLowerCase();
    pick.file = `footage/${id}-${pick.id}${ext}`;
  }
  const downloads = [...entries.values()].filter((e) => e.pick && !existsSync(join(dir, e.pick.file)));
  let bytes = 0;
  if (downloads.length) console.log(`Downloading ${downloads.length} files...`);
  await inGroups(downloads, 4, async ({ id, pick }) => {
    const url = pick.source === "Wikimedia Commons" ? await photoURL(pick.title) : pick.url;
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) throw new Error(`Couldn't download the ${pick.source} ${pick.kind} for scene ${id}: HTTP ${res.status}`);
    const data = Buffer.from(await res.arrayBuffer());
    writeFileSync(join(dir, pick.file), data);
    bytes += data.length;
  });

  const all = scenes.map((s) => entries.get(s.id));
  const picks = all.filter((e) => e.pick).map((e) => e.pick);
  const credits = [...new Map(picks.map((p) => [p.id, { source: p.source, title: p.title, author: p.author, license: p.license, pageURL: p.pageURL }])).values()];
  writeFileSync(footagePath, `${JSON.stringify({ title: video.title, slug: video.slug, fetchedAt: new Date().toISOString(), scenes: all, credits }, null, 2)}\n`);

  // Files no scene uses any more, e.g. after a swap.
  const used = new Set(picks.map((p) => p.file.replace("footage/", "")));
  const unused = readdirSync(footageDir).filter((f) => !used.has(f));
  for (const f of unused) rmSync(join(footageDir, f));

  const missing = all.filter((e) => !e.pick);
  const count = (fn) => picks.filter(fn).length;
  console.log(`
Done: ${picks.length} of ${all.length} scenes have footage: ${count((p) => p.kind === "video")} videos, ${count((p) => p.source === "Wikimedia Commons")} Wikimedia Commons photos, ${count((p) => p.source === "Pixabay" && p.kind === "photo")} Pixabay photos.
  Downloaded: ${downloads.length} files, ${(bytes / 1e6).toFixed(0)} MB, to media/${video.slug}/footage/${unused.length ? ` (removed ${unused.length} unused)` : ""}${
    missing.length ? `\n  Nothing fit, so these get a graphic instead: scenes ${missing.map((e) => e.id).join(", ")}` : ""
  }
  Credits needed in the description: ${credits.filter((c) => c.source === "Wikimedia Commons" && !/^(CC0|Public domain)/i.test(c.license)).length} Wikimedia Commons photos
  Claude cost: about $${totalSpent().toFixed(2)}
  Saved: media/${video.slug}/footage.json`);
}

main().catch((err) => {
  console.error(`\n${err.message}`);
  process.exit(1);
});
