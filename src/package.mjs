// Packaging: what a viewer sees before clicking, and the description under the
// video. Claude writes five title options, three thumbnail ideas (a headline naming
// the subject over one or two bright, real photos or aerial views from the video,
// which it sees, with a number tag or a receipt as the callout) and the story
// paragraphs, chapter names and tags. The thumbnails are rendered in the videos'
// look (remotion/stills/Thumbnail.jsx), and the description gets chapters from the
// narration's timing, the sources from the brief and the credits from footage.json.
//
//   npm run package -- walmart                 write it all, about $0.12 of Claude
//   npm run package -- walmart --keep-words    after editing package.json by hand
//                                              (the words, or a picture's "file",
//                                              from its "backgrounds" list): re-render
//                                              the thumbnails and rebuild the
//                                              description, without Claude
//
// Everything for the upload ends up in media/<slug>/package/: upload.txt (every
// field YouTube Studio asks for, in its order, with the text to paste), the video
// and captions (linked from render/, not copied) and the thumbnails. Files from an
// earlier run move to package/earlier/ rather than being replaced.
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
// How much a photo is enlarged past filling the frame (or its half of it), to
// bring its subject closer, and at most, to move the subject clear of the words;
// and how far past its own pixels it may be blown up.
const ZOOM = 1.4;
const MAX_ZOOM = 1.9;
const MAX_UPSCALE = 1.25;
const NEEDS_CREDIT = (license) => license && !/^(public domain|cc0|pixabay)/i.test(license);

const Picture = z.object({
  image: z.number().int().describe("Background image number"),
  subject: z
    .object({ x: z.number(), y: z.number() })
    .describe("For a photo: where its subject is, as fractions of its width and height from the top left (0.5, 0.5 is the middle)"),
  label: z
    .object({
      big: z.string().describe("A number or one or two words, at most 8 characters: '33%+', '<1%', 'BANKRUPT'"),
      small: z.string().describe("What it is, at most 26 characters: 'of the city's sales tax'"),
      tone: z.enum(["amber", "red", "light"]).describe("amber for the number that matters, red for a loss, light for the plain side of a contrast"),
    })
    .nullable()
    .describe("A tag on this picture, or null"),
});
const Package = z.object({
  titles: z.array(z.object({ title: z.string(), why: z.string() })),
  thumbnails: z.array(
    z.object({
      kicker: z.string().describe("A few small words above the headline, or empty"),
      headline: z.string().describe("Two to four words naming what the video is about, at most 22 characters"),
      accent: z.string().describe("The one headline word to color"),
      pictures: z.array(Picture).describe("One picture filling the frame, or two side by side"),
      receipt: z
        .object({
          title: z.string().describe("What the receipt is, at most 16 characters: 'City sales tax'"),
          item: z.string().describe("The circled line's item, at most 10 characters"),
          value: z.string().describe("Its value, at most 8 characters"),
          stamp: z.string().describe("An optional stamp across it, one word, or empty"),
        })
        .nullable()
        .describe("With one picture only: a receipt with one line circled, or null"),
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
// the narration says over it. A site from above before and after comes first, as
// two images in a row, since side by side they make the strongest contrast.
function backgrounds(plan, footage) {
  const narration = new Map(plan.scenes.map((s) => [s.id, s.narration]));
  const seen = new Set();
  const pairs = [];
  const found = [];
  for (const { id, pick } of footage.scenes) {
    if (!pick) continue;
    if (pick.kind === "change") {
      if (seen.has(pick.before.file)) continue;
      seen.add(pick.before.file);
      const site = [pick.label, pick.sublabel].filter(Boolean).join(", ");
      const shot = (s, about) => ({ kind: "change", file: s.file, width: pick.width, height: pick.height, pick, scene: id, about });
      pairs.push(
        shot(pick.before, `aerial photo of ${site} in ${pick.before.year}, BEFORE (the next image is the same view in ${pick.after.year}), the site circled`),
        shot(pick.after, `aerial photo of ${site} in ${pick.after.year}, AFTER (the image before is the same view in ${pick.before.year}), the site circled`),
      );
      continue;
    }
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
  return [...pairs, ...found].slice(0, MAX_IMAGES).map((b) => ({ ...b, about: `${b.about}; in the video under: "${narration.get(b.scene)?.slice(0, 160) ?? ""}"` }));
}

// The site's radius on an aerial image, in its pixels (as remotion/scenes/Aerial.jsx
// draws it, a little outside the site's box).
function siteRadius(pick, level) {
  const [x0, y0, x1, y1] = pick.box;
  return [Math.max(40, ((x1 - x0) / 2 / level.mpp) * 1.3), Math.max(30, ((y1 - y0) / 2 / level.mpp) * 1.3)];
}

// Where a background sits on the 1280×720 thumbnail: covering `box` ([x, y, w, h]),
// with its subject (a photo's, as Claude placed it, or an aerial view's site) as
// near `want` as the picture reaches.
function placement(bg, box, want, subject, radius = CIRCLE_RADIUS) {
  const [bx, by, bw, bh] = box;
  const fitted = (w, h, focus, scale) => {
    const left = Math.min(bx, Math.max(bx + bw - w * scale, want[0] - focus[0] * scale));
    const top = Math.min(by, Math.max(by + bh - h * scale, want[1] - focus[1] * scale));
    return [left + focus[0] * scale, top + focus[1] * scale];
  };
  if (bg.kind === "photo") {
    const { width: w, height: h } = bg;
    const sx = Math.min(0.95, Math.max(0.05, subject?.x ?? 0.5));
    const sy = Math.min(0.95, Math.max(0.05, subject?.y ?? 0.5));
    const cover = Math.max(bw / w, bh / h);
    // Big enough for the subject to reach its spot with no gap at the edges.
    const needed = Math.max((want[0] - bx) / (sx * w), (bx + bw - want[0]) / ((1 - sx) * w), (want[1] - by) / (sy * h), (by + bh - want[1]) / ((1 - sy) * h));
    // Closer than the photo was taken, so its subject reads at a glance, but not
    // blown up much past its own pixels.
    const scale = Math.max(cover, Math.min(cover * MAX_ZOOM, MAX_UPSCALE, Math.max(cover * ZOOM, needed)));
    const focus = [sx * w, sy * h];
    return { focus, at: fitted(w, h, focus, scale), scale, circle: null };
  }
  if (bg.kind === "change") {
    // The site's outline is kept as shares of the picture (src/naip.mjs).
    const { x0, x1, y0, y1 } = bg.pick.site;
    const site = [((x0 + x1) / 2) * bg.width, ((y0 + y1) / 2) * bg.height];
    const circle = [Math.max(40, ((x1 - x0) / 2) * bg.width * 1.2), Math.max(30, ((y1 - y0) / 2) * bg.height * 1.2)];
    const scale = Math.max(radius / circle[0], bw / bg.width, bh / bg.height);
    return { focus: site, at: fitted(bg.width, bg.height, site, scale), scale, circle };
  }
  const { level, pick } = bg;
  const [rx, ry] = siteRadius(pick, level);
  const site = [level.width / 2 + (pick.box[0] + pick.box[2]) / 2 / level.mpp, level.height / 2 - (pick.box[1] + pick.box[3]) / 2 / level.mpp];
  const scale = Math.max(radius / rx, bw / level.width, bh / level.height);
  return { focus: site, at: fitted(level.width, level.height, site, scale), scale, circle: [rx, ry] };
}

// The thumbnail's layout. One picture fills the frame, its subject on the side
// away from the callout (a label or a receipt); two split it, each labelled. The
// headline takes the top, and the bottom-right corner, where YouTube shows the
// video's length, is kept clear.
// How far the split between two pictures leans, as in remotion/stills/Thumbnail.jsx.
const LEAN = 70;
function layout(t, images) {
  const [W, H] = [1280, 720];
  const bgOf = (p) => images.find((b) => b.file === p.file);
  const image = (p, box, want, radius) => {
    const bg = bgOf(p);
    return { src: bg.file, width: bg.width, height: bg.height, ...placement(bg, box, want, p.subject, radius) };
  };
  if (t.pictures.length >= 2) {
    const [a, b] = t.pictures;
    const half = W / 2 + LEAN / 2;
    return {
      kicker: t.kicker,
      headline: t.headline,
      accent: t.accent,
      receipt: null,
      panels: [
        { clip: "left", image: image(a, [0, 0, half, H], [W * 0.25, H * 0.45], 120), label: a.label && { ...a.label, at: [W * 0.25, 470], width: 520 } },
        { clip: "right", image: image(b, [W - half, 0, half, H], [W * 0.75, H * 0.45], 120), label: b.label && { ...b.label, at: [W * 0.74, 470], width: 500 } },
      ],
    };
  }
  const [p] = t.pictures;
  const callout = Boolean(p.label || t.receipt);
  // The callout goes on the side away from the subject.
  const subjectLeft = (p.subject?.x ?? 0.5) <= 0.5 || ["aerial", "change"].includes(bgOf(p).kind);
  const calloutX = subjectLeft ? W * 0.74 : W * 0.26;
  const want = [callout ? (subjectLeft ? W * 0.32 : W * 0.68) : W * 0.5, H * 0.58];
  return {
    kicker: t.kicker,
    headline: t.headline,
    accent: t.accent,
    panels: [{ clip: "full", image: image(p, [0, 0, W, H], want), label: p.label && !t.receipt ? { ...p.label, at: [calloutX, 340], width: 520 } : null }],
    receipt: t.receipt && { ...t.receipt, at: [calloutX, 440] },
  };
}

// The words on a thumbnail, for the summary and the upload sheet.
const thumbnailWords = (t) =>
  [
    [t.kicker, t.headline].filter(Boolean).join(" "),
    ...t.pictures.filter((p) => p.label).map((p) => `${p.label.big} ${p.label.small}`),
    t.receipt && `receipt: ${t.receipt.item} ${t.receipt.value}`,
  ]
    .filter(Boolean)
    .join(" / ");

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
      if (!t.headline || !t.pictures?.length) {
        throw new Error("package.json has thumbnails in the old layout (lines over one picture). Run without --keep-words to write new ones.");
      }
      for (const p of t.pictures) {
        if (p.file && !images.some((b) => b.file === p.file)) {
          throw new Error(`package.json: a thumbnail uses ${p.file}, which isn't one of the backgrounds listed there.`);
        }
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
    // A reply now and then stops short (one thumbnail, no description); it's asked again once.
    for (let tries = 1; ; tries++) {
      const reply = await ask({ label: "package", effort: "medium", maxTokens: 16000, system: SYSTEM, user: content, format: betaZodOutputFormat(Package) });
      words = Package.parse(JSON.parse(reply));
      const whole = words.thumbnails.length >= 3 && words.description.length && words.chapters.length && words.titles.length >= 5;
      if (whole || tries === 2) break;
      console.log("  The reply stopped short; asking again...");
    }
    keepEarlier(wordsPath);
  }
  // Each thumbnail's picture by file, and the pictures it could use instead, so
  // package.json can be edited by hand.
  for (const t of words.thumbnails) {
    t.pictures = t.pictures.slice(0, 2);
    // A receipt needs the frame to itself.
    if (t.pictures.length > 1) t.receipt = null;
    if (t.receipt && !t.receipt.stamp) delete t.receipt.stamp;
    for (const p of t.pictures) p.file ??= (images[p.image - 1] ?? images[0]).file;
  }
  words.backgrounds = images.map((b) => ({ file: b.file, about: b.about }));
  writeFileSync(wordsPath, `${JSON.stringify(words, null, 2)}\n`);

  // Thumbnails.
  console.log(`Rendering ${words.thumbnails.length} thumbnails...`);
  const publicDir = join(out, ".public");
  rmSync(publicDir, { recursive: true, force: true });
  mkdirSync(join(publicDir, "footage"), { recursive: true });
  const used = [];
  for (const p of words.thumbnails.flatMap((t) => t.pictures)) {
    const bg = images.find((b) => b.file === p.file);
    if (!existsSync(join(publicDir, bg.file))) linkSync(join(dir, bg.file), join(publicDir, bg.file));
    used.push(bg);
  }
  const serveUrl = await bundle({ entryPoint: ENTRY, publicDir });
  const thumbnails = [];
  for (const [i, t] of words.thumbnails.entries()) {
    const props = layout(t, images);
    const composition = await selectComposition({ serveUrl, id: "Thumbnail", inputProps: props });
    const file = join(out, `thumbnail-${i + 1}.jpg`);
    keepEarlier(file);
    for (const quality of [92, 85, 75]) {
      await renderStill({ serveUrl, composition, inputProps: props, output: file, imageFormat: "jpeg", jpegQuality: quality });
      if (statSync(file).size <= THUMBNAIL_BYTES) break;
    }
    const pictures = t.pictures.map((p) => images.find((b) => b.file === p.file).about.split(";")[0]);
    thumbnails.push({ file: `thumbnail-${i + 1}.jpg`, words: thumbnailWords(t), background: pictures.join(" | ") });
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
  if (footage.scenes.some((e) => e.pick?.kind === "change")) credits.push("Before-and-after aerial photos: USDA NAIP, via Microsoft Planetary Computer (public domain)");

  // Sources a document card shows on screen go first, so viewers can find them.
  const headings = plan.scenes.filter((s) => s.document).map((s) => s.document.heading.toLowerCase());
  const onScreen = (s) => headings.some((h) => s.text.toLowerCase().startsWith(h) || h.startsWith(s.text.split(" — ")[0].toLowerCase()));
  const sources = sourcesOf(brief);
  const chapters = chapterList(parts, words.chapters);
  const description = describe(words, chapters, credits, sources, onScreen);
  for (const name of ["upload.txt", "sources.txt", "description.txt", "pinned-comment.txt"]) keepEarlier(join(out, name));
  writeFileSync(join(out, "sources.txt"), `${sources.map((s) => `${s.text}: ${s.url}`).join("\n")}\n`);

  // The pinned comment, as edited on the Notion page.
  let pinned = null;
  try {
    const section = pageSection(await getMarkdown(video.id), "Pinned comment");
    if (section) pinned = unescapeMarkdown(section).replace(/^>\s?/gm, "").trim();
  } catch (err) {
    console.log(`  (Couldn't read the pinned comment from Notion: ${err.message})`);
  }

  // The video and captions, linked in (not copied) so everything for the upload
  // is in this one folder.
  const linked = [];
  for (const [from, to] of [
    [join(dir, "render", `${video.slug}.mp4`), "video.mp4"],
    [join(dir, "render", `${video.slug}.srt`), "captions.srt"],
  ]) {
    rmSync(join(out, to), { force: true });
    if (!existsSync(from)) continue;
    linkSync(from, join(out, to));
    linked.push(to);
  }
  // The video's own length, end screen included.
  const probe = (file) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" }));
  const length = linked.includes("video.mp4") ? clock(probe(join(out, "video.mp4"))) : null;
  const sheet = uploadSheet({ video, words, thumbnails, description: description.text, pinned, length, captions: linked.includes("captions.srt") });
  writeFileSync(join(out, "upload.txt"), sheet);

  const long = words.titles.filter((t) => t.title.length > 70);
  console.log(`
Done. Everything for the upload is in media/${video.slug}/package/, listed in upload.txt:
  Titles (Claude's first choice first):
${words.titles.map((t, i) => `    ${i + 1}. ${t.title} (${t.title.length})`).join("\n")}${long.length ? "\n    Over 70 characters gets cut off in search results." : ""}
  Thumbnails:
${thumbnails.map((t) => `    ${t.file}: ${t.words} (${t.background})`).join("\n")}
  Description: ${description.text.length.toLocaleString("en-US")} of 5,000 characters, ${chapters.length} chapters, ${credits.length} credits, ${description.included} of ${sources.length} sources${
    description.left ? ` (all ${sources.length} are in sources.txt)` : ""
  }${length ? "" : "\n  No render yet: run npm run render, then this again to add the video and captions."}${pinned ? "" : "\n  No pinned comment on the Notion page."}
  To change the words or a background, edit package.json and run with --keep-words.
  Claude cost: about $${totalSpent().toFixed(2)}
  Open: open media/${video.slug}/package/upload.txt`);
}

// Every field YouTube Studio asks for, in its order, with the text to paste.
function uploadSheet({ video, words, thumbnails, description, pinned, length, captions }) {
  const rule = "-".repeat(60);
  const block = (text) => [rule, text, rule].join("\n");
  const steps = [
    ["VIDEO", length ? `Upload video.mp4 (${length}, in this folder). Leave it Private until step 11.` : "Not rendered yet: run npm run render, then npm run package again."],
    ["TITLE (pick one; the first is Claude's choice)", words.titles.map((t) => t.title).join("\n")],
    ["DESCRIPTION (paste everything between the lines)", block(description)],
    ["THUMBNAIL (pick one)", thumbnails.map((t) => `${t.file}: ${t.words.toUpperCase()}`).join("\n")],
    ["AUDIENCE", "No, it's not made for kids."],
    ["ALTERED CONTENT", "Yes. The background music is composed by AI (ElevenLabs Music)."],
    ["TAGS (under Show more; paste as one line)", words.tags.join(", ")],
    ["LANGUAGE AND CATEGORY (under Show more)", "Video language: English\nCaption certification: This content has never aired on television in the U.S.\nCategory: Education"],
    ["SUBTITLES (Video elements)", captions ? "Add, English, Upload file, With timing: captions.srt" : "No captions yet: they come with the render."],
    ["END SCREEN (Video elements)", "Add a Subscribe element, and a video once the channel has another. The last 12 seconds are left clear for them."],
    ["CHECKS, THEN PUBLISH", 'Wait until Copyright and Ad suitability both say "No issues found", then set visibility to Public (or schedule it).'],
    ["PINNED COMMENT (once the video is public: post it as the first comment, then pin it; a scheduled video takes no comments until then)", pinned ? block(pinned) : "None on the Notion page."],
    ["AFTERWARDS", "Set the video's Status in Notion to Scheduled (or Published), with the YouTube link in Notes."],
  ];
  return `${[
    `UPLOAD: ${video.title}`,
    "Everything YouTube Studio asks for, in its order. The files named here are in this folder.",
    ...steps.map(([heading, body], i) => `${i + 1}. ${heading}\n${body}`),
  ].join("\n\n")}\n`;
}

main().catch((err) => {
  console.error(`\n${err.message}`);
  process.exit(1);
});
