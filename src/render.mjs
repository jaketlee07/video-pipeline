// Render (guide stage 8): assembles the video in Remotion (remotion/) from the
// narration and its timings, the scene plan and the footage, and writes
// media/<slug>/render/<slug>.mp4. Moves the row to "Review" when it's done.
//
//   npm run render                          the row with Status "Approved"
//   npm run render -- walmart               the row with "walmart" in its title
//   npm run render -- walmart --preview 120 30 seconds starting at 2:00, to preview.mp4
//   npm run render -- walmart --studio      open it in Remotion Studio to scrub through
//   npm run music -- walmart                just the music (src/music.mjs), with
//                                           render/music-preview.m4a to listen to
import { spawn } from "node:child_process";
import { existsSync, linkSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { totalSpent } from "./claude.mjs";
import { prepareGraphics } from "./graphics.mjs";
import { prepareMusic, previewMix } from "./music.mjs";
import { APPROVED, findVideo, updateVideo } from "./notion.mjs";
import { videoDir } from "./paths.mjs";

const args = process.argv.slice(2);
const force = args.includes("--force");
const studio = args.includes("--studio");
const musicOnly = args.includes("--music");
const previewAt = args.includes("--preview") ? Number(args[args.indexOf("--preview") + 1] ?? 0) : null;
const query = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--preview").join(" ") || undefined;

const FPS = 30;
const PREVIEW_SECONDS = 30;
const ENTRY = fileURLToPath(new URL("../remotion/index.jsx", import.meta.url));
const FOOTAGE_TYPES = ["stock", "image", "aerial"];
// A quiet hold after the last word for YouTube's end screen, whose video and
// subscribe elements cover the last 5 to 20 seconds.
const END_SCREEN_SECONDS = 12;
// The longest a held shot may stay on screen, counting the scene it came from.
const MAX_HOLD_SECONDS = 15;

const frameAt = (seconds) => Math.round(seconds * FPS);

// Groups the narrator's words into lines of up to about 42 characters, breaking at
// sentence ends and pauses.
function captionLines(words) {
  const lines = [];
  let line = null;
  for (const [i, w] of words.entries()) {
    const prev = words[i - 1];
    const sentenceEnd = prev && /[.?!]["”')]?$/.test(prev.text) && line.words.length >= 3;
    if (!line || line.text.length + 1 + w.text.length > 42 || sentenceEnd || w.start - prev.end > 0.6) {
      line = { start: w.start, end: w.end, text: "", words: [] };
      lines.push(line);
    }
    line.words.push({ text: w.text, start: w.start });
    line.text += `${line.text ? " " : ""}${w.text}`;
    line.end = w.end;
  }
  // Each line stays up until the next one starts, or briefly after its last word.
  return lines.map((l, i) => ({ start: l.start, end: Math.min(lines[i + 1]?.start ?? Infinity, l.end + 0.7), words: l.words }));
}

// A flow diagram the template can draw: two to five parties with unique ids, and
// up to six moves between them. Returns null when there's nothing to draw.
function cleanFlow(flow) {
  if (!flow) return null;
  const parties = flow.parties.filter((p, i, all) => all.findIndex((q) => q.id === p.id) === i).slice(0, 5);
  const ids = new Set(parties.map((p) => p.id));
  const moves = flow.moves.filter((m) => ids.has(m.from) && ids.has(m.to) && m.from !== m.to).slice(0, 6);
  return parties.length >= 2 && moves.length ? { ...flow, parties, moves } : null;
}

// The shot a scene continues from where `source` left off, for scenes that hold
// the previous shot.
function continueShot(source) {
  const media = { ...source.media };
  // An aerial zoom keeps pushing in slowly from where it stopped.
  // The finest image covers the closer of its two ends, so it stays sharp.
  if (media.kind === "aerial") {
    const closest = Math.min(media.startMpp, media.endMpp);
    return { ...media, intro: false, startMpp: media.endMpp, endMpp: media.endMpp > closest ? media.endMpp * 0.85 : closest * 0.85 };
  }
  if (media.kind !== "video") return media;
  // Past the end of a short clip, start it again from the top.
  media.trimBefore = (media.trimBefore + Math.round(source.frames * media.rate)) % Math.max(1, frameAt(media.duration - 1));
  return media;
}

// Closed captions for YouTube, in SubRip format: two lines of up to about 42
// characters per caption, joined when they're one sentence and under 6 seconds.
function srt(words) {
  const lines = captionLines(words);
  const cues = [];
  for (let i = 0; i < lines.length; i++) {
    const [a, b] = [lines[i], lines[i + 1]];
    const text = (l) => l.words.map((w) => w.text).join(" ");
    const endsSentence = /[.?!]["”')]?$/.test(a.words.at(-1).text);
    if (b && !endsSentence && b.end - a.start <= 6) {
      cues.push({ start: a.start, end: b.end, text: `${text(a)}\n${text(b)}` });
      i++;
    } else {
      cues.push({ start: a.start, end: a.end, text: text(a) });
    }
  }
  const stamp = (t) => {
    const ms = Math.round(t * 1000);
    const pad = (n, w = 2) => String(n).padStart(w, "0");
    return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
  };
  return cues.map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.text}\n`).join("\n");
}

// How a picked clip or photo plays in a scene of `frames` frames.
function mediaFor(pick, frames) {
  const seconds = frames / FPS;
  if (pick.kind === "aerial") {
    const { label, sublabel, circle, box, move, startMpp, endMpp } = pick;
    const levels = pick.levels.map((l) => ({ src: l.file, mpp: l.mpp, width: l.width, height: l.height }));
    return { kind: "aerial", levels, label, sublabel, circle, box, move, startMpp, endMpp };
  }
  const credit =
    pick.source !== "Pixabay" && pick.license && !/^(CC0|public domain)/i.test(pick.license)
      ? `${pick.kind === "video" ? "Video" : "Photo"}: ${pick.author.slice(0, 60)} · ${pick.license} · ${pick.source}`
      : null;
  if (pick.kind === "photo") return { kind: "photo", src: pick.file, credit };
  // Skip the first half second (often a fade in) when the clip is long enough, and
  // slow clips a little that are shorter than the scene.
  const rate = Math.max(0.75, Math.min(1, pick.duration / seconds));
  const trimBefore = pick.duration - seconds > 0.5 ? frameAt(0.5) : 0;
  return { kind: "video", src: pick.file, duration: pick.duration, rate, trimBefore, credit };
}

async function main() {
  const video = await findVideo(query, "Approved");
  if (!APPROVED.includes(video.status) && !force) {
    throw new Error(`"${video.title}" is "${video.status}". Approve the script in Notion first, or add --force.`);
  }
  const dir = videoDir(video.slug);
  const read = (name, hint) => {
    if (!existsSync(join(dir, name))) throw new Error(`"${video.title}" has no ${name} yet. Run ${hint} first.`);
    return JSON.parse(readFileSync(join(dir, name), "utf8"));
  };
  const plan = read("scenes.json", "npm run scenes");
  const timing = read("timing.json", "npm run voice");
  const footage = read("footage.json", "npm run footage");
  const picks = new Map(footage.scenes.map((e) => [e.id, e.pick]));
  const times = new Map(timing.scenes.map((s) => [s.id, s]));

  // A stock or image scene with nothing picked holds the shot right before it, the
  // way an editor would, but only straight after its own pick and only while the two
  // together stay short, so a clip never comes back minutes later under unrelated
  // narration and a photo never sits on screen for half a minute.
  // Otherwise it gets a text card; an aerial without a photo gets a map.
  const hasPick = (s) => s && FOOTAGE_TYPES.includes(s.type) && picks.get(s.id);
  const unfilled = (s) => FOOTAGE_TYPES.includes(s.type) && !picks.get(s.id);
  const span = (...list) => list.reduce((sum, s) => sum + times.get(s.id).end - times.get(s.id).start, 0);
  const holds = new Set(
    plan.scenes
      .filter((s, i) => unfilled(s) && s.type !== "aerial" && hasPick(plan.scenes[i - 1]) && span(plan.scenes[i - 1], s) <= MAX_HOLD_SECONDS)
      .map((s) => s.id),
  );
  const needsMap = (s) => s.type === "map" || (s.type === "aerial" && !picks.get(s.id));
  const needsCard = (s) => unfilled(s) && s.type !== "aerial" && !holds.has(s.id);
  const graphics = await prepareGraphics(
    video,
    dir,
    plan.scenes.filter((s) => s.type === "number"),
    [...plan.scenes.filter((s) => s.type === "title"), ...plan.scenes.filter(needsCard).map((s) => ({ ...s, standIn: true }))],
    plan.scenes.filter(needsMap),
  );

  // What each scene shows.
  const scenes = plan.scenes.map((s) => {
    const { start, end } = times.get(s.id);
    const base = { id: s.id, from: frameAt(start), frames: frameAt(end) - frameAt(start) };
    const g = graphics.get(s.id) ?? {};
    const fallbackTitle = { style: "statement", text: s.text ?? s.flow?.title ?? s.place ?? s.part, attribution: null };
    const flow = s.type === "flow" ? cleanFlow(s.flow) : null;
    if (flow) return { ...base, kind: "flow", flow };
    if (s.type === "document" && s.document) return { ...base, kind: "document", document: s.document };
    if (s.type === "chart" && s.chart) return { ...base, kind: "chart", chart: s.chart };
    if (s.type === "number") return { ...base, kind: "number", number: g.number ?? { headline: s.text ?? "", label: "", count: null } };
    if (g.map) return { ...base, kind: "map", map: g.map };
    if (FOOTAGE_TYPES.includes(s.type) && picks.get(s.id)) return { ...base, kind: "footage", media: mediaFor(picks.get(s.id), base.frames) };
    if (holds.has(s.id)) return { ...base, kind: "hold" };
    // Only the narrator's question for viewers gets the "tell us in the comments" tag.
    const title = g.title ?? fallbackTitle;
    if (title.style === "question" && !/comments/i.test(s.narration)) title.style = "statement";
    return { ...base, kind: "title", title };
  });
  for (const [i, scene] of scenes.entries()) {
    if (scene.kind === "hold") Object.assign(scene, { kind: "footage", media: continueShot(scenes[i - 1]) });
  }
  // A number or a key line right after a shot goes over that shot, darkened, the
  // way an editor would put big words on the footage. Section openers and the
  // question for viewers keep the plain background.
  for (const [i, scene] of scenes.entries()) {
    const prev = scenes[i - 1];
    const overShot = scene.kind === "number" || (scene.kind === "title" && ["statement", "quote"].includes(scene.title.style));
    if (overShot && prev?.kind === "footage") scene.backdrop = continueShot(prev);
  }

  const last = scenes.at(-1);
  const spoken = Math.max(timing.duration, (last.from + last.frames) / FPS);
  scenes.push({ id: last.id + 1, from: frameAt(spoken), frames: frameAt(END_SCREEN_SECONDS), kind: "end" });
  const props = { fps: FPS, duration: spoken + END_SCREEN_SECONDS, scenes };
  const renderDir = join(dir, "render");
  mkdirSync(renderDir, { recursive: true });
  const music = await prepareMusic(video, dir, { plan, timing, length: props.duration });
  props.music = Boolean(music);
  if (musicOnly) {
    if (!music) return;
    const preview = join(renderDir, "music-preview.m4a");
    const loudness = previewMix(dir, timing, preview);
    console.log(`
Done: the music for "${video.title}" is in media/${video.slug}/music.wav (${music.clips.length} plays; details in music.json).
  Narration and music together: ${loudness.toFixed(1)} LUFS (YouTube plays at -14)${music.credits.length ? `\n  Credits needed in the description: ${music.credits.join("; ")}` : ""}
  Claude cost: about $${totalSpent().toFixed(2)}
  Listen: open media/${video.slug}/render/music-preview.m4a`);
    return;
  }
  // Upload this with the video (YouTube Studio → Subtitles), rather than burning
  // captions in: it's exact, including the place names auto-captions get wrong.
  writeFileSync(join(renderDir, `${video.slug}.srt`), srt(timing.words));
  // Remotion copies its public folder into each bundle, so it gets one holding only
  // the narration, the music and the footage used. Hard links, since Remotion won't serve
  // files through symlinks.
  const publicDir = join(renderDir, "public");
  rmSync(publicDir, { recursive: true, force: true });
  mkdirSync(join(publicDir, "footage"), { recursive: true });
  linkSync(join(dir, timing.audio), join(publicDir, "narration.wav"));
  if (music) linkSync(join(dir, "music.wav"), join(publicDir, "music.wav"));
  const filesOf = (media) => (media ? [media.src, ...(media.levels ?? []).map((l) => l.src)] : []);
  for (const file of new Set(scenes.flatMap((s) => [...filesOf(s.media), ...filesOf(s.backdrop)]).filter(Boolean))) {
    linkSync(join(dir, file), join(publicDir, file));
  }
  const propsPath = join(renderDir, "props.json");
  writeFileSync(propsPath, JSON.stringify(props));

  if (studio) {
    console.log("Opening Remotion Studio (Ctrl+C to stop)...");
    spawn("npx", ["remotion", "studio", ENTRY, `--props=${propsPath}`, `--public-dir=${publicDir}`], { stdio: "inherit" });
    return;
  }

  const previous = video.status;
  const full = previewAt === null;
  const kinds = scenes.reduce((acc, s) => ({ ...acc, [s.kind]: (acc[s.kind] ?? 0) + 1 }), {});
  console.log(`Rendering "${video.title}"${full ? "" : ` from ${previewAt} s`}: ${Object.entries(kinds).map(([k, n]) => `${n} ${k}`).join(", ")}`);
  if (full) await updateVideo(video.id, { status: "Rendering" });
  let serveUrl;
  try {
    console.log("Bundling...");
    serveUrl = await bundle({ entryPoint: ENTRY, publicDir });
    const composition = await selectComposition({ serveUrl, id: "LongForm", inputProps: props });
    const outputLocation = join(renderDir, full ? `${video.slug}.mp4` : "preview.mp4");
    const frameRange = full ? null : [frameAt(previewAt), Math.min(composition.durationInFrames, frameAt(previewAt + PREVIEW_SECONDS)) - 1];
    const started = Date.now();
    let reported = -1;
    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      outputLocation,
      inputProps: props,
      frameRange,
      onProgress: ({ progress }) => {
        const pct = Math.floor(progress * 20) * 5;
        if (pct === reported) return;
        reported = pct;
        const elapsed = (Date.now() - started) / 1000;
        const left = progress > 0.02 ? Math.round((elapsed / progress - elapsed) / 60) : "?";
        console.log(`  ${pct}% (about ${left} min left)`);
      },
    });
    // The video is done even if Notion can't be reached now.
    let moved = false;
    if (full) {
      try {
        await updateVideo(video.id, { status: "Review" });
        moved = true;
      } catch (err) {
        console.log(`\n${err.message} Set "${video.title}" to Review by hand.`);
      }
    }
    console.log(`
Done: media/${video.slug}/render/${full ? `${video.slug}.mp4` : "preview.mp4"} (${Math.round((Date.now() - started) / 60000)} min)
  Captions: media/${video.slug}/render/${video.slug}.srt (upload it as the video's subtitles)${
      moved ? `\n  "${video.title}" is now in Review: watch it once (checkpoint 2).` : ""
    }
  Claude cost: about $${totalSpent().toFixed(2)}
  Watch: open media/${video.slug}/render/${full ? `${video.slug}.mp4` : "preview.mp4"}`);
  } catch (err) {
    if (full) await updateVideo(video.id, { status: previous });
    throw err;
  } finally {
    // The bundle holds a copy of the narration and footage.
    if (serveUrl) rmSync(serveUrl, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(`\n${err.stack ?? err.message}`);
  process.exit(1);
});
