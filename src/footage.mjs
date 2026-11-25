// Footage (guide stages 6 and 7): for every stock and image scene, gathers
// candidates from Pixabay (videos and photos), Coverr (videos, when COVERR_API_KEY
// is set; see src/coverr.mjs), Wikimedia Commons (real videos and
// photos of the places and companies named) and, for scenes about the past, the
// Internet Archive (public-domain old film), has Claude pick the best from a still
// of each (a sheet of numbered stills for a Commons or Archive video, one per
// uninterrupted stretch), and downloads the pick to media/<slug>/footage/. Photos
// get a slow pan and zoom in the render. Aerial scenes fly down onto the real place
// using US aerial imagery (src/aerial.mjs), and look for a photo only if the place
// can't be found. footage.json lists each pick with its runners-up, plus the
// credits for the video description. Scenes where nothing fits get a graphic instead.
//
//   npm run footage                     the row with Status "Approved"
//   npm run footage -- walmart          the row with "walmart" in its title
//   npm run footage -- walmart --redo=19,28   pick scenes 19 and 28 again (say, after
//                                       changing the prompts); the rest stay as they are
//
// Scenes already in footage.json are kept. To swap a pick, copy one of the scene's
// alternates into its "pick" and run this again; to re-pick from scratch, delete the
// scene's entry.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { ask, prompt, totalSpent } from "./claude.mjs";
import { prepareAerials } from "./aerial.mjs";
import { searchArchive } from "./archive.mjs";
import { agentFor, photoURL, searchCommons, searchCommonsVideos } from "./commons.mjs";
import { coverrPage, searchCoverr } from "./coverr.mjs";
import { captureWebsites, dateOf } from "./website.mjs";
import { APPROVED, findVideo } from "./notion.mjs";
import { videoDir } from "./paths.mjs";
import { rendition, searchPhotos, searchVideos, tagScore } from "./pixabay.mjs";
import { downloadStretch, shotSheet } from "./shots.mjs";

const args = process.argv.slice(2);
const force = args.includes("--force");
// Scene numbers to pick again even though nothing in them changed, e.g. after editing the prompts.
const redo = new Set((args.find((a) => a.startsWith("--redo="))?.slice(7) ?? "").split(",").filter(Boolean).map(Number));
const query = args.filter((a) => !a.startsWith("--")).join(" ") || undefined;

const FOOTAGE_TYPES = ["stock", "image", "aerial"];
// Most candidates per scene from each source. Aerial scenes only use Commons: stock
// drone shots can't show the actual place.
const PER_SCENE = { company: 3, video: 4, coverr: 3, commonsVideo: 2, archive: 2, pixabayPhoto: 2, commons: 3, aerialCommons: 5 };
// An Archive film runs ten to twenty minutes, so its sheet samples more of it.
const ARCHIVE_STILLS = 12;
const PER_QUERY = 2;
const PER_UPLOADER = 2;
const MIN_TAG_SCORE = 0.5;
const SCENES_PER_CALL = 8;
// A clip can be slowed to fill a slightly longer scene.
const MIN_LENGTH_SHARE = 0.75;
const SYSTEM = "You choose footage for a faceless YouTube channel of case studies on how the world really works.";

const Picks = z.object({
  picks: z.array(
    z.object({
      scene: z.number().int(),
      candidate: z.number().int().describe("Candidate number, or 0 if none fit"),
      shot: z.number().int().describe("For a video shown as numbered stills, the number of the still to use; otherwise 0"),
    }),
  ),
});
const Searches = z.object({ scenes: z.array(z.object({ scene: z.number().int(), queries: z.array(z.string()) })) });
const CommonsPlan = z.object({
  company: z.string().nullable(),
  companySearches: z.array(z.string()),
  scenes: z.array(z.object({ scene: z.number().int(), queries: z.array(z.string()), company: z.boolean() })),
});

// Runs `fn` over `items`, `size` at a time.
async function inGroups(items, size, fn) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}

// A still shrunk to 480 pixels wide (about 190 tokens instead of 1,200), or null if
// it can't be fetched or read. It goes through a temp file: piping it into ffmpeg
// can deadlock.
let stills = 0;
async function still(url) {
  const res = await fetch(url, { headers: { "User-Agent": agentFor(url) } }).catch(() => null);
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

const sceneKey = (scene) => JSON.stringify(scene.change ? [scene.visual, scene.search, scene.change] : [scene.visual, scene.search]);

// Candidates the picker let through despite its rules, filtered out before it sees
// them: clips tagged as horror, clips tagged with a place outside the US (unless the
// scene is about that place), and scanned maps or records offered as a photo of a place.
const OFF_TONE = ["horror", "halloween", "scary", "spooky", "creepy", "zombie", "ghost", "haunted", "blood", "monster", "nightmare", "demon", "skull"];
const ABROAD = [
  "europe", "european", "germany", "deutschland", "berlin", "munich", "hamburg", "frankfurt", "cologne", "düsseldorf", "france", "paris",
  "italy", "rome", "spain", "madrid", "barcelona", "portugal", "lisbon", "england", "london", "britain", "uk", "scotland", "ireland",
  "dublin", "netherlands", "amsterdam", "belgium", "brussels", "austria", "vienna", "switzerland", "zurich", "poland", "warsaw", "czech",
  "prague", "hungary", "budapest", "croatia", "bosnia", "sarajevo", "serbia", "romania", "bulgaria", "greece", "athens", "istanbul",
  "russia", "moscow", "ukraine", "kyiv", "sweden", "stockholm", "norway", "oslo", "denmark", "copenhagen", "finland", "helsinki",
  "iceland", "india", "mumbai", "delhi", "beijing", "shanghai", "hong kong", "japan", "tokyo", "korea", "seoul", "vietnam", "thailand",
  "bangkok", "indonesia", "bali", "philippines", "malaysia", "singapore", "australia", "sydney", "melbourne", "new zealand", "brazil",
  "argentina", "mexico", "canada", "ontario", "quebec", "alberta", "british columbia", "toronto", "vancouver", "montreal", "africa", "nigeria", "kenya", "egypt", "cairo", "morocco",
  "dubai", "israel", "iran", "isfahan", "tehran", "iraq", "baghdad", "najaf", "pakistan", "bangladesh", "nepal",
];
// Commons videos that are never the footage this channel wants: police bodycams and
// chases, trailers, product reviews and sit-down interviews.
const VIDEO_JUNK = /\b(bodycam|body cam|dashcam|shooting|shoots?|police|sheriff|deputy|officers?|suspect|pursuit|chase|pit maneuver|arrest|busted|stealing|trailer|review|interview|endorses|gameplay)\b/i;
const MAPLIKE = /\b(maps?|census|plat|survey|enumeration|diagram|blueprint|floor plan|site plan|locator)\b/i;
function allowed(scene, text, kind) {
  const about = `${scene.narration} ${scene.place ?? ""} ${scene.visual}`.toLowerCase();
  // US places that contain a foreign name.
  const t = text.toLowerCase().replace(/\bnew (mexico|england|london|york|jersey|hampshire|orleans)\b/g, "");
  const named = (word) => new RegExp(`(^|[^\\p{L}])${word}($|[^\\p{L}])`, "u").test(t) && !about.includes(word);
  if (OFF_TONE.some(named) || ABROAD.some(named)) return false;
  return kind !== "commons" || !MAPLIKE.test(text) || (scene.type !== "aerial" && /\bmap\b/i.test(scene.visual));
}

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
const fromCoverr = (hit, query) => ({
  id: `cv${hit.id}`,
  source: "Coverr",
  kind: "video",
  about: `${Math.round(hit.duration)} seconds. Title: ${hit.title}. Tags: ${(hit.tags ?? []).join(", ")}`,
  title: hit.title,
  pageURL: coverrPage(hit),
  author: "Coverr",
  license: "Coverr License",
  duration: Number(hit.duration),
  width: hit.max_width,
  height: hit.max_height,
  url: hit.urls.mp4_download,
  thumbnail: hit.poster ?? hit.thumbnail,
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

const fromCommonsVideo = (video, query) => ({
  id: `v${video.pageid}`,
  pageid: video.pageid,
  source: "Wikimedia Commons",
  kind: "video",
  about: `Title: ${video.title}. ${Math.round(video.duration)} seconds at ${video.width}×${video.height}, shown as numbered stills, one from each uninterrupted stretch long enough for the scene`,
  title: video.title,
  pageURL: video.pageURL,
  author: video.author,
  license: video.license,
  width: video.width,
  height: video.height,
  encodings: video.encodings,
  videoLength: video.duration,
  query,
});

const fromArchive = (film, query) => ({
  id: `a${film.identifier}`,
  pageid: `ia-${film.identifier}`,
  source: "Internet Archive",
  kind: "video",
  about: `Title: ${film.title} (${film.year ?? "year unknown"}), from ${film.collection}. ${Math.round(film.duration)} seconds of old film at ${film.width}×${film.height}, shown as numbered stills, one from each uninterrupted stretch long enough for the scene. The catalog says: ${film.description || "nothing"}`,
  title: film.title,
  year: film.year,
  pageURL: film.pageURL,
  author: film.author,
  license: film.license,
  width: film.width,
  height: film.height,
  encodings: film.encodings,
  videoLength: film.duration,
  stills: ARCHIVE_STILLS,
  query,
});

const sceneList = (scenes, tried = new Map()) =>
  scenes
    .map((s) => {
      const lines = [`## Scene ${s.id} (${s.type})`, `On screen: ${s.visual}`, `Narration: ${s.narration}`];
      if (s.place) lines.push(`Place: ${s.place}`);
      if (tried.has(s.id)) lines.push(`Already searched: ${tried.get(s.id).join(" | ")}`);
      return lines.join("\n");
    })
    .join("\n\n");

// Asks Claude for searches, scene by scene. Returns scene ID → queries.
async function suggestSearches(label, promptName, title, scenes, tried = new Map()) {
  const reply = await ask({
    label,
    effort: "medium",
    maxTokens: 16000,
    system: SYSTEM,
    user: prompt(promptName, { title, scenes: sceneList(scenes, tried) }),
    format: betaZodOutputFormat(Searches),
  });
  return new Map(Searches.parse(JSON.parse(reply)).scenes.map((s) => [s.scene, s.queries.slice(0, 3)]));
}

// Commons searches scene by scene and, when the video is about a company, searches
// for that company's own recognizable things and which scenes are about it.
async function planCommons(title, scenes) {
  const reply = await ask({
    label: "commons searches",
    effort: "medium",
    maxTokens: 16000,
    system: SYSTEM,
    user: prompt("commons", { title, scenes: sceneList(scenes) }),
    format: betaZodOutputFormat(CommonsPlan),
  });
  const plan = CommonsPlan.parse(JSON.parse(reply));
  const company = plan.company?.trim() || null;
  return {
    queries: new Map(plan.scenes.map((s) => [s.scene, s.queries.slice(0, 3)])),
    company,
    companySearches: company ? plan.companySearches.slice(0, 8) : [],
    companyScenes: new Set(company ? plan.scenes.filter((s) => s.company).map((s) => s.scene) : []),
  };
}

// Commons photos and videos whose title names the company: its vans, trucks,
// buildings, signs. Offered to every scene about it, so a viewer sees who the
// story is about instead of an unbranded stand-in.
async function companyPool(company, searches) {
  const named = new RegExp(`(^|[^\\p{L}])${company.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}])`, "iu");
  const pool = [];
  const seen = new Set();
  for (const q of searches) {
    for (const v of await searchCommonsVideos(q)) {
      if (named.test(v.title) && !VIDEO_JUNK.test(v.title) && !seen.has(v.title)) pool.push({ video: v, query: q }), seen.add(v.title);
    }
    for (const p of await searchCommons(q)) {
      if (named.test(p.title) && !MAPLIKE.test(p.title) && !seen.has(p.title)) pool.push({ photo: p, query: q }), seen.add(p.title);
    }
  }
  return pool;
}

// The pool's items in order of how many words they share with the scene.
function forScene(scene, pool) {
  const words = (text) => new Set(text.toLowerCase().match(/\p{L}{4,}/gu) ?? []);
  const about = words(`${scene.visual} ${scene.narration} ${(scene.search ?? []).join(" ")}`);
  const score = (item) => [...words(`${(item.photo ?? item.video).title} ${item.query}`)].filter((w) => about.has(w)).length;
  return pool.map((item, i) => ({ item, i, s: score(item) })).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.item);
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
        const sheet = c.encodings ? await shotSheet(c, scene.seconds, c.stills) : null;
        const image = c.encodings ? sheet?.image : await still(c.thumbnail);
        if (!image) continue;
        list.push(sheet ? { ...c, windows: sheet.windows } : c);
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
    for (const { scene, candidate, shot } of Picks.parse(JSON.parse(reply)).picks) {
      const c = shown.get(scene)?.[candidate - 1] ?? null;
      if (!c?.windows) {
        chosen.set(scene, c);
        continue;
      }
      // A Commons or Archive video plays just the chosen stretch.
      const { windows, stills, ...pick } = c;
      const w = windows[shot - 1] ?? windows[0];
      chosen.set(scene, { ...pick, start: w.start, duration: w.end - w.start });
    }
  });
  return chosen;
}

async function main() {
  const video = await findVideo(query, "Approved");
  if (!APPROVED.includes(video.status) && !force) {
    throw new Error(`"${video.title}" is "${video.status}". Approve the script in Notion first, or add --force.`);
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
    // Aerial scenes picked before the aerial zooms existed get one now.
    if (scene && !redo.has(scene.id) && entry.key === sceneKey(scene) && (scene.type !== "aerial" || entry.zoomTried)) kept.set(scene.id, entry);
  }
  const todo = scenes.filter((s) => !kept.has(s.id));
  console.log(`Footage for "${video.title}": ${scenes.length} scenes${kept.size ? ` (${kept.size} already picked)` : ""}.`);

  // Each candidate goes to one scene only, and each uploader gets at most two slots
  // per scene, since popular results are often one shoot.
  const taken = new Set([...kept.values()].flatMap((e) => [e.pick, ...e.alternates].filter(Boolean).map((c) => c.id)));
  async function gather(scene, pixabayQueries, commonsQueries, archiveQueries = [], pool = []) {
    const found = { company: [], video: [], coverr: [], commonsVideo: [], archive: [], pixabayPhoto: [], commons: [] };
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
    for (const { photo, video, query } of forScene(scene, pool)) {
      if (photo && allowed(scene, photo.title, "commons")) add("company", PER_SCENE.company, fromCommons(photo, query));
      if (video && video.duration >= scene.seconds * MIN_LENGTH_SHARE && (scene.type !== "stock" || video.width >= 1280) && allowed(scene, video.title, "commons")) {
        add("company", PER_SCENE.company, fromCommonsVideo(video, query));
      }
    }
    for (const q of commonsQueries) {
      const photos = (await searchCommons(q)).filter((p) => allowed(scene, p.title, "commons"));
      take("commons", commonsLimit, photos.map((p) => fromCommons(p, q)));
    }
    if (scene.type !== "aerial") {
      for (const q of commonsQueries) {
        // Stock scenes need sharp footage; real footage of a named place can be older.
        const videos = (await searchCommonsVideos(q)).filter(
          (v) => (scene.type !== "stock" || v.width >= 1280) && v.duration >= scene.seconds * MIN_LENGTH_SHARE && !VIDEO_JUNK.test(v.title) && allowed(scene, v.title, "commons"),
        );
        take("commonsVideo", PER_SCENE.commonsVideo, videos.map((v) => fromCommonsVideo(v, q)));
      }
      for (const q of archiveQueries) {
        const films = (await searchArchive(q).catch(() => [])).filter(
          (f) => f.duration >= scene.seconds * MIN_LENGTH_SHARE && !VIDEO_JUNK.test(f.title) && allowed(scene, f.title, "archive"),
        );
        take("archive", PER_SCENE.archive, films.map((f) => fromArchive(f, q)));
      }
      // One Coverr search a scene, since the free plan allows 50 an hour. No
      // AI-generated clips: the channel shows real things.
      for (const q of pixabayQueries.slice(0, 1)) {
        const clips = (await searchCoverr(q)).filter(
          (h) =>
            h.urls?.mp4_download && !h.is_vertical && h.max_width > h.max_height && h.max_width >= 1280 && h.is_ai_generated !== true && h.is_premium !== true &&
            h.duration >= scene.seconds * MIN_LENGTH_SHARE && allowed(scene, `${h.title} ${(h.tags ?? []).join(" ")}`),
        );
        take("coverr", PER_SCENE.coverr, clips.map((h) => fromCoverr(h, q)));
      }
      for (const q of pixabayQueries) {
        const videos = (await searchVideos(q)).filter((h) => {
          const v = rendition(h);
          return v && v.width > v.height && v.width >= 1280 && !h.isAiGenerated && !h.isLowQuality && h.duration >= scene.seconds * MIN_LENGTH_SHARE && allowed(scene, h.tags);
        });
        take("video", PER_SCENE.video, byTags(videos, q).map((h) => fromVideo(h, q)));
        const photos = (await searchPhotos(q)).filter((h) => h.imageWidth > h.imageHeight && h.imageWidth >= 1920 && !h.isAiGenerated && allowed(scene, h.tags));
        take("pixabayPhoto", PER_SCENE.pixabayPhoto, byTags(photos, q).map((h) => fromPixabayPhoto(h, q)));
      }
    }
    return [...found.company, ...found.commonsVideo, ...found.archive, ...found.coverr, ...found.video, ...found.commons, ...found.pixabayPhoto];
  }

  // Aerial scenes fly down onto the real place; only where it can't be found do
  // they look for a photo.
  const zooms = await prepareAerials(video, dir, todo.filter((s) => s.type === "aerial"));
  const searching = todo.filter((s) => !zooms.get(s.id));
  const candidates = new Map(todo.map((s) => [s.id, []]));
  if (searching.length) {
    console.log(`Planning Wikimedia Commons searches for ${searching.length} scenes...`);
    const { queries: commonsQueries, company, companySearches, companyScenes } = await planCommons(video.title, searching);
    const pool = company && companyScenes.size ? await companyPool(company, companySearches) : [];
    if (pool.length) console.log(`  ${pool.length} Wikimedia Commons photos and videos of ${company} itself, offered to the ${companyScenes.size} scenes about it`);
    // Only scenes about the past get old film; Claude leaves the rest without searches.
    const archiveScenes = searching.filter((s) => s.type !== "aerial");
    const archiveQueries = archiveScenes.length ? await suggestSearches("archive searches", "archive", video.title, archiveScenes) : new Map();
    const looking = [...archiveQueries.values()].filter((q) => q.length).length;
    console.log(`Searching Pixabay and Wikimedia Commons${looking ? `, and the Internet Archive for ${looking} ${looking === 1 ? "scene" : "scenes"} about the past` : ""}...`);
    for (const scene of searching) {
      const offered = companyScenes.has(scene.id) && scene.type !== "aerial" ? pool : [];
      candidates.set(scene.id, await gather(scene, scene.search, commonsQueries.get(scene.id) ?? [], archiveQueries.get(scene.id) ?? [], offered));
    }
  }
  const chosen = await pickFootage(video.title, searching, candidates);
  for (const [id, zoom] of zooms) if (zoom) chosen.set(id, zoom);

  // Where nothing fit, search again with simpler words, as an editor would.
  const retry = searching.filter((s) => !chosen.get(s.id));
  if (retry.length) {
    console.log(`Nothing fit for ${retry.length} scenes; searching again with simpler words...`);
    const tried = new Map(retry.map((s) => [s.id, [...new Set([...s.search, ...candidates.get(s.id).map((c) => c.query)])]]));
    const queries = await suggestSearches("new searches", "requery", video.title, retry, tried);
    const more = new Map();
    for (const scene of retry) more.set(scene.id, await gather(scene, queries.get(scene.id) ?? [], queries.get(scene.id) ?? []));
    for (const [id, pick] of await pickFootage(video.title, retry, more)) chosen.set(id, pick);
    for (const scene of retry) candidates.set(scene.id, [...candidates.get(scene.id), ...more.get(scene.id)]);
  }

  // Website scenes show the real page: your own screenshot when there's one in
  // screenshots/<scene>.png (or .jpg), otherwise a capture (src/website.mjs).
  // Document scenes whose source is a web page show the real article, with the
  // quoted words highlighted, whenever the quote is really on it; otherwise they
  // keep the paper card.
  const webScenes = plan.scenes.filter((s) => (s.type === "website" && s.website) || (s.type === "document" && s.document?.url));
  const requestFor = (s) => {
    if (s.type === "website") return { id: s.id, ...s.website };
    const { url, date, quote = null, highlight = null } = s.document;
    return { id: s.id, url, date: dateOf(date), quote, highlight: quote ? highlight : null, article: true };
  };
  const webKey = (s) => (s.type === "website" ? JSON.stringify(s.website) : JSON.stringify(requestFor(s)));
  const webEntries = new Map();
  const capturing = [];
  for (const s of webScenes) {
    const own = s.type === "website" && ["png", "jpg", "jpeg"].map((ext) => `screenshots/${s.id}.${ext}`).find((f) => existsSync(join(dir, f)));
    if (own) {
      const [width, height] = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", join(dir, own)], { encoding: "utf8" }).trim().split(",").map(Number);
      // Shown at a browser's width; a Retina screenshot is twice that.
      const scale = width > 2000 ? 2 : 1;
      webEntries.set(s.id, { id: s.id, type: "website", key: webKey(s), pick: { id: `web-${s.id}`, kind: "website", source: "Screenshot", file: own, url: s.website.url, pageURL: s.website.url, archived: null, title: null, width: width / scale, height: height / scale, box: null } });
      continue;
    }
    // A capture that failed isn't tried again (the document keeps its card)
    // unless the scene changes or is listed in --redo.
    const old = previous.find((e) => e.id === s.id);
    const usable = !old?.pick || (old.pick.kind === "website" && old.pick.source !== "Screenshot" && existsSync(join(dir, old.pick.file)));
    if (old?.key === webKey(s) && usable && !redo.has(s.id)) webEntries.set(s.id, old);
    else capturing.push(s);
  }
  if (capturing.length) {
    const pages = capturing.filter((s) => s.type === "website").length;
    const articles = capturing.length - pages;
    console.log(
      `Capturing ${[pages && `${pages} web ${pages === 1 ? "page" : "pages"}`, articles && `${articles} ${articles === 1 ? "source" : "sources"} for document scenes`].filter(Boolean).join(" and ")} (Wayback Machine copies where there are any)...`,
    );
    const shots = await captureWebsites(capturing.map(requestFor), dir);
    for (const s of capturing) {
      const { pick = null, error } = shots.get(s.id) ?? {};
      if (error) console.log(`  Scene ${s.id}: ${s.type === "website" ? "no picture of" : "keeps its paper card, no page for"} ${requestFor(s).url}: ${error}`);
      else console.log(`  Scene ${s.id}: ${pick.source === "Live page" ? "live page" : `archived ${pick.archived}`}${pick.marks?.length ? `, ${{ highlight: "quote highlighted", underline: "headline underlined", circle: "words circled" }[pick.mark]}` : ""}`);
      webEntries.set(s.id, { id: s.id, type: s.type, key: webKey(s), pick });
    }
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
      alternates: candidates.get(scene.id).filter((c) => c.id !== pick?.id),
      ...(scene.type === "aerial" ? { zoomTried: true } : {}),
    });
  }
  for (const { id, pick } of entries.values()) {
    if (!pick || ["aerial", "change", "website"].includes(pick.kind)) continue;
    const ext = pick.kind === "video" ? ".mp4" : extname(pick.title ?? new URL(pick.url).pathname).toLowerCase();
    pick.file = `footage/${id}-${pick.id}${ext}`;
  }
  const downloads = [...entries.values()].filter((e) => e.pick && !["aerial", "change", "website"].includes(e.pick.kind) && !existsSync(join(dir, e.pick.file)));
  let bytes = 0;
  if (downloads.length) console.log(`Downloading ${downloads.length} files...`);
  await inGroups(downloads, 4, async ({ id, pick }) => {
    if (pick.encodings) {
      // An alternate swapped in by hand plays from the start.
      if (pick.start === undefined) Object.assign(pick, { start: 0.5, duration: Math.min(pick.videoLength - 0.5, entries.get(id).seconds + 1) });
      await downloadStretch(pick, join(dir, pick.file));
      bytes += statSync(join(dir, pick.file)).size;
      return;
    }
    const url = pick.source === "Wikimedia Commons" ? await photoURL(pick.title) : pick.url;
    const res = await fetch(url, { headers: { "User-Agent": agentFor(url) } });
    if (!res.ok) throw new Error(`Couldn't download the ${pick.source} ${pick.kind} for scene ${id}: HTTP ${res.status}`);
    const data = Buffer.from(await res.arrayBuffer());
    writeFileSync(join(dir, pick.file), data);
    bytes += data.length;
  });

  const all = [...scenes.map((s) => entries.get(s.id)), ...webEntries.values()].sort((a, b) => a.id - b.id);
  const picks = all.filter((e) => e.pick).map((e) => e.pick);
  // All the aerial zooms share one credit, and all the before-and-afters another.
  // Public-domain and CC0 picks are listed too, which costs nothing and answers a
  // copyright claim on them.
  const creditKey = (p) => ({ aerial: "usgs", change: "naip" })[p.kind] ?? p.id;
  const credits = [
    ...new Map(picks.filter((p) => p.kind !== "website").map((p) => [creditKey(p), { source: p.source, title: p.title, author: p.author, license: p.license, pageURL: p.pageURL }])).values(),
  ];
  writeFileSync(footagePath, `${JSON.stringify({ title: video.title, slug: video.slug, fetchedAt: new Date().toISOString(), scenes: all, credits }, null, 2)}\n`);

  // Files no scene uses any more, e.g. after a swap.
  const filesOf = (p) => (p.kind === "aerial" ? p.levels.map((l) => l.file) : p.kind === "change" ? [p.before.file, p.after.file] : [p.file]);
  const used = new Set(picks.flatMap(filesOf).filter((f) => f.startsWith("footage/")).map((f) => f.replace("footage/", "")));
  const unused = readdirSync(footageDir).filter((f) => !used.has(f));
  for (const f of unused) rmSync(join(footageDir, f));

  const docs = all.filter((e) => e.type === "document");
  const missing = all.filter((e) => !e.pick && e.type !== "document");
  const count = (fn) => picks.filter((p) => fn(p) && !docs.some((d) => d.pick === p)).length;
  console.log(`
Done: ${picks.length - docs.filter((d) => d.pick).length} of ${all.length - docs.length} scenes have footage: ${count((p) => p.kind === "aerial")} aerial zooms, ${count((p) => p.kind === "change")} before-and-afters, ${count((p) => p.kind === "video" && p.source === "Wikimedia Commons")} Wikimedia Commons videos, ${count((p) => p.source === "Internet Archive")} Internet Archive films, ${count((p) => p.source === "Coverr")} Coverr videos, ${count((p) => p.kind === "video" && p.source === "Pixabay")} Pixabay videos, ${count((p) => p.kind === "photo" && p.source === "Wikimedia Commons")} Wikimedia Commons photos, ${count((p) => p.source === "Pixabay" && p.kind === "photo")} Pixabay photos${count((p) => p.kind === "website") ? `, ${count((p) => p.kind === "website")} web pages` : ""}.
${docs.length ? `  Document scenes showing the real page: ${docs.filter((d) => d.pick).length} of ${docs.length} (the rest keep the paper card)\n` : ""}  Downloaded: ${downloads.length} files, ${(bytes / 1e6).toFixed(0)} MB, to media/${video.slug}/footage/${unused.length ? ` (removed ${unused.length} unused)` : ""}${
    missing.length ? `\n  Nothing fit, so these get a graphic instead: scenes ${missing.map((e) => e.id).join(", ")}` : ""
  }
  Credits needed in the description: ${credits.filter((c) => c.source !== "Pixabay" && c.license && !/^(CC0|Public domain)/i.test(c.license)).length} Wikimedia Commons, Internet Archive and Coverr videos and photos
  Claude cost: about $${totalSpent().toFixed(2)}
  Saved: media/${video.slug}/footage.json`);
}

main().catch((err) => {
  console.error(`\n${err.message}`);
  process.exit(1);
});
