// Packaging: what a viewer sees before clicking, and the description under the
// video. Claude writes five title options, three thumbnail ideas (a few big words
// over a real photo or aerial view from the video, which it sees) and the story
// paragraphs, chapter names and tags. The thumbnails are rendered in the videos'
// look (remotion/stills/Thumbnail.jsx), and the description gets chapters from the
// narration's timing, the sources from the brief and the credits from footage.json.
//
//   npm run package -- walmart                 write it all, about $0.10 of Claude
//   npm run package -- walmart --keep-words    after editing package.json by hand
//                                              (the words, or a thumbnail's "file",
//                                              from its "backgrounds" list): re-render
//                                              the thumbnails and rebuild the
//                                              description, without Claude
//
// Everything goes to media/<slug>/package/; files from an earlier run move to
// package/earlier/ rather than being replaced.
import { execFileSync } from "node:child_process";
import { existsSync, linkSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import { z } from "zod";
import { ask, prompt, totalSpent } from "./claude.mjs";
import { APPROVED, findVideo, getMarkdown, pageSection, unescapeMarkdown } from "./notion.mjs";
import { clock, partsOf } from "./parts.mjs";
import { keepEarlier, videoDir } from "./paths.mjs";

const args = process.argv.slice(2);
const force = args.includes("--force");
const keepWords = args.includes("--keep-words");
const query = args.filter((a) => !a.startsWith("--")).join(" ") || undefined;

const ENTRY = fileURLToPath(new URL("../remotion/index.jsx", import.meta.url));
const SYSTEM = "You package videos for a faceless YouTube channel of case studies on how the world really works.";
// YouTube's limit is 5,000 characters; a little is kept spare.
const DESCRIPTION_LIMIT = 4900;
// YouTube rejects a thumbnail over 2 MB.
const THUMBNAIL_BYTES = 2e6;
// A chapter must run at least 10 seconds.
const MIN_CHAPTER = 10;
const MAX_IMAGES = 16;
// How big the pen loop around a site is on the thumbnail, in pixels across.
const CIRCLE_RADIUS = 190;
// Real photos a thumbnail can use without a share-alike or no-derivatives license
// attaching to it. Stock photos aren't of the real place, so they're left out.
const FREE_TO_ADAPT = /^(public domain|cc0|cc by [\d.]+)$/i;
// How much a photo may be enlarged past filling the frame, to move its subject
// clear of the words.
const MAX_ZOOM = 1.5;
const NEEDS_CREDIT = (license) => license && !/^(public domain|cc0|pixabay)/i.test(license);

const Package = z.object({
  titles: z.array(z.object({ title: z.string(), why: z.string() })),
  thumbnails: z.array(
    z.object({
      lines: z.array(z.string()).describe("One to three short lines"),
      accent: z.string().describe("The one word to color"),
      image: z.number().int().describe("Background image number"),
      side: z.enum(["left", "right"]).describe("Where the words go"),
      subject: z
        .object({ x: z.number(), y: z.number() })
        .describe("For a photo: where its subject is, as fractions of its width and height from the top left (0.5, 0.5 is the middle)"),
      why: z.string(),
    }),
  ),
  description: z.array(z.string()).describe("Two or three paragraphs"),
  chapters: z.array(z.object({ part: z.number().int(), title: z.string() })),
  tags: z.array(z.string()),
});

// A 480-pixel-wide JPEG of a local image, as base64.
function small(path) {
  return execFileSync("ffmpeg", ["-v", "error", "-nostdin", "-i", path, "-vf", "scale=480:-2", "-frames:v", "1", "-f", "image2", "-c:v", "mjpeg", "-q:v", "4", "-"], {
    stdio: ["ignore", "pipe", "ignore"],
  }).toString("base64");
}

// Photos and aerial views from the video that a thumbnail can use, each with what
// the narration says over it.
function backgrounds(plan, footage) {
  const narration = new Map(plan.scenes.map((s) => [s.id, s.narration]));
  const seen = new Set();
  const found = [];
  for (const { id, pick } of footage.scenes) {
    if (!pick) continue;
    if (pick.kind === "photo" && pick.source !== "Pixabay" && FREE_TO_ADAPT.test(pick.license ?? "")) {
      if (seen.has(pick.id)) continue;
      seen.add(pick.id);
      const what = pick.title ? `"${pick.title}" from ${pick.source}` : `a ${pick.source} photo tagged ${pick.about.replace(/^Tags: /, "")}`;
      found.push({ kind: "photo", file: pick.file, width: pick.width, height: pick.height, pick, scene: id, about: `photo, ${what}` });
    } else if (pick.kind === "aerial" && pick.circle && pick.box) {
      const key = pick.center.join();
      if (seen.has(key)) continue;
      seen.add(key);
      // The finest image where the site still fits, circled at CIRCLE_RADIUS.
      const level = [...pick.levels].reverse().find((l) => CIRCLE_RADIUS / siteRadius(pick, l)[0] >= 720 / l.height) ?? pick.levels[0];
      found.push({ kind: "aerial", file: level.file, width: level.width, height: level.height, level, pick, scene: id, about: `aerial view of ${[pick.label, pick.sublabel].filter(Boolean).join(", ")}, the site circled` });
    }
  }
  return found.slice(0, MAX_IMAGES).map((b) => ({ ...b, about: `${b.about}; in the video under: "${narration.get(b.scene)?.slice(0, 160) ?? ""}"` }));
}

// The site's radius on an aerial image, in its pixels (as remotion/scenes/Aerial.jsx
// draws it, a little outside the site's box).
function siteRadius(pick, level) {
  const [x0, y0, x1, y1] = pick.box;
  return [Math.max(40, ((x1 - x0) / 2 / level.mpp) * 1.3), Math.max(30, ((y1 - y0) / 2 / level.mpp) * 1.3)];
}

// Where the background sits on the 1280×720 thumbnail: its subject (a photo's, as
// Claude placed it, or an aerial view's site) on the far side from the words, as
// far as the picture reaches.
function placement(bg, side, subject) {
  const [W, H] = [1280, 720];
  const want = [side === "left" ? W * 0.7 : W * 0.3, H * 0.5];
  if (bg.kind === "photo") {
    const { width: w, height: h } = bg;
    const sx = Math.min(0.95, Math.max(0.05, subject?.x ?? 0.5));
    const sy = Math.min(0.95, Math.max(0.05, subject?.y ?? 0.5));
    const cover = Math.max(W / w, H / h);
    // Big enough for the subject to reach its spot with no gap at the edges.
    const needed = Math.max(want[0] / (sx * w), (W - want[0]) / ((1 - sx) * w), want[1] / (sy * h), (H - want[1]) / ((1 - sy) * h));
    const scale = Math.min(cover * MAX_ZOOM, Math.max(cover, needed));
    const focus = [sx * w, sy * h];
    const left = Math.min(0, Math.max(W - w * scale, want[0] - focus[0] * scale));
    const top = Math.min(0, Math.max(H - h * scale, want[1] - focus[1] * scale));
    return { focus, at: [left + focus[0] * scale, top + focus[1] * scale], scale, circle: null };
  }
  const { level, pick } = bg;
  const [rx, ry] = siteRadius(pick, level);
  const site = [level.width / 2 + (pick.box[0] + pick.box[2]) / 2 / level.mpp, level.height / 2 - (pick.box[1] + pick.box[3]) / 2 / level.mpp];
  const scale = Math.max(CIRCLE_RADIUS / rx, W / level.width, H / level.height);
  const left = Math.min(0, Math.max(W - level.width * scale, want[0] - site[0] * scale));
  const top = Math.min(0, Math.max(H - level.height * scale, want[1] - site[1] * scale));
  return { focus: site, at: [left + site[0] * scale, top + site[1] * scale], scale, circle: [rx, ry] };
}

// The brief's Sources list: [{ text, url }], minus notes after the link.
function sourcesOf(brief) {
  const list = brief.split(/^#+\s*Sources\s*$/m)[1] ?? "";
  return [...list.matchAll(/^\s*\d+\.\s*\[(.+?)\]\((\S+?)\)/gm)].map((m) => ({ text: m[1], url: m[2] }));
}

// Chapters from the script's parts, with Claude's names. A part too short to be a
// chapter joins the one before it.
function chapterList(parts, names) {
  const named = new Map(names.map((c) => [c.part, c.title]));
  const chapters = [];
  for (const [i, part] of parts.entries()) {
    const title = named.get(i + 1);
    if (chapters.length && (!title || title === chapters.at(-1).title)) continue;
    chapters.push({ start: chapters.length ? part.start : 0, title: title ?? part.name, end: part.end });
  }
  for (const [i, c] of chapters.entries()) c.end = chapters[i + 1]?.start ?? parts.at(-1).end;
  // Too short to count: folded into the chapter before.
  return chapters.filter((c, i) => i === 0 || c.end - c.start >= MIN_CHAPTER);
}

const clean = (text) => text.replace(/[<>]/g, "");

// The description: Claude's paragraphs, chapters, credits, then as many sources as
// fit (those shown on screen first). Returns { text, sources, left out }.
function describe(words, chapters, credits, sources, onScreen) {
  const head = [
    ...words.description,
    ["Chapters", ...chapters.map((c) => `${clock(c.start)} ${c.title}`)].join("\n"),
  ];
  const tail = credits.length ? [["Photo and footage credits", ...credits].join("\n")] : [];
  const ordered = [...sources.filter((s) => onScreen(s)), ...sources.filter((s) => !onScreen(s))];
  const lines = [];
  const build = (heading) => [...head, ...(lines.length ? [[heading, ...lines].join("\n")] : []), ...tail].map(clean).join("\n\n");
  for (const s of ordered) {
    lines.push(`${s.text}: ${s.url}`);
    if (build("Sources").length > DESCRIPTION_LIMIT) {
      lines.pop();
      break;
    }
  }
  const left = sources.length - lines.length;
  return { text: build(left ? "Selected sources" : "Sources"), included: lines.length, left };
}

async function main() {
  const video = await findVideo(query, "Review");
  if (!APPROVED.includes(video.status) && !force) {
    throw new Error(`"${video.title}" is "${video.status}". Package a video once its script is approved, or add --force.`);
  }
  const dir = videoDir(video.slug);
  const read = (name) => {
    if (!existsSync(join(dir, name))) throw new Error(`"${video.title}" has no ${name} yet. Run the earlier stages first.`);
    return readFileSync(join(dir, name), "utf8");
  };
  const plan = JSON.parse(read("scenes.json"));
  const timing = JSON.parse(read("timing.json"));
  const footage = JSON.parse(read("footage.json"));
  const brief = read("brief.md");
  const out = join(dir, "package");
  mkdirSync(out, { recursive: true });
  const parts = partsOf(plan, timing);
  const images = backgrounds(plan, footage);
  if (!images.length) throw new Error(`"${video.title}" has no photo or aerial view a thumbnail could use.`);

  let words;
  const wordsPath = join(out, "package.json");
  if (keepWords) {
    if (!existsSync(wordsPath)) throw new Error(`There's no package/package.json to keep yet. Run npm run package -- "${query ?? video.title}" first.`);
    words = JSON.parse(readFileSync(wordsPath, "utf8"));
    for (const t of words.thumbnails ?? []) {
      if (t.file && !images.some((b) => b.file === t.file)) {
        throw new Error(`package.json: a thumbnail uses ${t.file}, which isn't one of the backgrounds listed there.`);
      }
    }
    console.log(`Rebuilding the package for "${video.title}" from package.json...`);
  } else {
    console.log(`Packaging "${video.title}": titles, thumbnails, description...`);
    const facts = brief.split(/^###?\s*Key facts\s*$/m)[1]?.split(/^###?\s/m)[0]?.trim() ?? "";
    const listing = parts.map((p, i) => `### Part ${i + 1}: ${p.name} (${clock(p.start)})\n${p.text}`).join("\n\n");
    const content = [{ type: "text", text: prompt("package", { title: video.title, parts: listing, facts }) }];
    for (const [i, bg] of images.entries()) {
      content.push({ type: "text", text: `Image ${i + 1}: ${bg.about}` });
      content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: small(join(dir, bg.file)) } });
    }
    const reply = await ask({ label: "package", effort: "medium", maxTokens: 16000, system: SYSTEM, user: content, format: betaZodOutputFormat(Package) });
    words = Package.parse(JSON.parse(reply));
    keepEarlier(wordsPath);
  }
  // Each thumbnail's picture by file, and the pictures it could use instead, so
  // package.json can be edited by hand.
  for (const t of words.thumbnails) t.file ??= (images[t.image - 1] ?? images[0]).file;
  words.backgrounds = images.map((b) => ({ file: b.file, about: b.about }));
  writeFileSync(wordsPath, `${JSON.stringify(words, null, 2)}\n`);

  // Thumbnails.
  console.log(`Rendering ${words.thumbnails.length} thumbnails...`);
  const publicDir = join(out, ".public");
  rmSync(publicDir, { recursive: true, force: true });
  mkdirSync(join(publicDir, "footage"), { recursive: true });
  const used = [];
  for (const t of words.thumbnails) {
    const bg = images.find((b) => b.file === t.file);
    if (!existsSync(join(publicDir, bg.file))) linkSync(join(dir, bg.file), join(publicDir, bg.file));
    used.push(bg);
  }
  const serveUrl = await bundle({ entryPoint: ENTRY, publicDir });
  const thumbnails = [];
  for (const [i, t] of words.thumbnails.entries()) {
    const bg = used[i];
    const props = { image: { src: bg.file, width: bg.width, height: bg.height, ...placement(bg, t.side, t.subject) }, lines: t.lines, accent: t.accent, side: t.side };
    const composition = await selectComposition({ serveUrl, id: "Thumbnail", inputProps: props });
    const file = join(out, `thumbnail-${i + 1}.jpg`);
    keepEarlier(file);
    for (const quality of [92, 85, 75]) {
      await renderStill({ serveUrl, composition, inputProps: props, output: file, imageFormat: "jpeg", jpegQuality: quality });
      if (statSync(file).size <= THUMBNAIL_BYTES) break;
    }
    thumbnails.push({ file: `thumbnail-${i + 1}.jpg`, words: t.lines.join(" / "), background: bg.about.split(";")[0] });
  }
  rmSync(publicDir, { recursive: true, force: true });

  // Credits: every pick whose license asks for one, plus any thumbnail background.
  const credited = new Map();
  for (const p of [...footage.scenes.map((e) => e.pick).filter(Boolean), ...used.map((b) => b.pick)]) {
    if (p.kind === "aerial" || !NEEDS_CREDIT(p.license) || credited.has(p.id)) continue;
    credited.set(p.id, `${p.kind === "video" ? "Video" : "Photo"}: ${(p.author ?? "unknown").slice(0, 60)}, ${p.license}, ${p.source}: ${p.pageURL}`);
  }
  const credits = [...credited.values()];
  if (footage.scenes.some((e) => e.pick?.kind === "aerial")) credits.push("Aerial imagery: USDA NAIP, via USGS The National Map (public domain)");

  // Sources a document card shows on screen go first, so viewers can find them.
  const headings = plan.scenes.filter((s) => s.document).map((s) => s.document.heading.toLowerCase());
  const onScreen = (s) => headings.some((h) => s.text.toLowerCase().startsWith(h) || h.startsWith(s.text.split(" — ")[0].toLowerCase()));
  const sources = sourcesOf(brief);
  const chapters = chapterList(parts, words.chapters);
  const description = describe(words, chapters, credits, sources, onScreen);
  for (const name of ["description.txt", "sources.txt", "pinned-comment.txt"]) keepEarlier(join(out, name));
  writeFileSync(join(out, "description.txt"), `${description.text}\n`);
  writeFileSync(join(out, "sources.txt"), `${sources.map((s) => `${s.text}: ${s.url}`).join("\n")}\n`);

  // The pinned comment, as edited on the Notion page.
  let pinned = null;
  try {
    pinned = pageSection(await getMarkdown(video.id), "Pinned comment");
    if (pinned) writeFileSync(join(out, "pinned-comment.txt"), `${unescapeMarkdown(pinned).replace(/^>\s?/gm, "").trim()}\n`);
  } catch (err) {
    console.log(`  (Couldn't read the pinned comment from Notion: ${err.message})`);
  }

  const long = words.titles.filter((t) => t.title.length > 70);
  console.log(`
Done. In media/${video.slug}/package/:
  Titles (pick one; Claude's first choice first):
${words.titles.map((t, i) => `    ${i + 1}. ${t.title} (${t.title.length})`).join("\n")}${long.length ? "\n    Over 70 characters gets cut off in search results." : ""}
  Thumbnails:
${thumbnails.map((t) => `    ${t.file}: ${t.words} (${t.background})`).join("\n")}
  description.txt: ${description.text.length.toLocaleString("en-US")} of 5,000 characters, ${chapters.length} chapters, ${credits.length} credits, ${description.included} of ${sources.length} sources${
    description.left ? ` (all ${sources.length} are in sources.txt)` : ""
  }
  Tags: ${words.tags.join(", ")}${pinned ? "\n  pinned-comment.txt: to post and pin as the first comment" : ""}
  To change the words or a background, edit package.json and run with --keep-words.
  Claude cost: about $${totalSpent().toFixed(2)}
  Open: open media/${video.slug}/package/`);
}

main().catch((err) => {
  console.error(`\n${err.message}`);
  process.exit(1);
});
