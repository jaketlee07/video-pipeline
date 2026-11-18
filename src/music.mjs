// Background music. The library is instrumental tracks in media/music/<mood>/
// (curious, tense, somber, hopeful; any other folder name works as a mood too),
// composed once by ElevenLabs Music (npm run music:library). Claude gives each
// part of the script a mood. Tracks of that mood play under the part, crossfading
// where the mood changes, quiet under the narration (the word timings say exactly
// when the narrator is talking), rising a little in the pauses and under the end
// screen.
//
// Writes media/<slug>/music.wav (the full-length music, already at its level) and
// music.json. src/render.mjs mixes it under the narration; `npm run music` builds
// just the sound, with a preview to listen to before rendering.
//
// A track that needs a credit (one added by hand from elsewhere) gets a .txt beside
// it with the credit line, which is listed in music.json for the description.
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { ask, prompt } from "./claude.mjs";
import { clock, partsOf } from "./parts.mjs";

export const LIBRARY = fileURLToPath(new URL("../media/music/", import.meta.url));
// What each mood folder is for, told to Claude when it picks.
export const MOODS = {
  curious: "light and steady, for setting things up and explaining how something works",
  tense: "dark and building, for reveals, closures and things going wrong",
  somber: "slow and reflective, for the people and places that lose out",
  hopeful: "warm and rising, for turnarounds, the takeaway and the ending",
};
const AUDIO = /\.(mp3|wav|m4a|aac|flac|ogg)$/i;
// Shorter tracks are stings or loops, not beds.
const MIN_TRACK_SECONDS = 45;
const RATE = 44100;

// Levels. Each track is first set to TRACK_LUFS, then moved by these. The
// narration plays at about -14 LUFS, so under it the music sits about 17 dB lower.
const TRACK_LUFS = -20;
const UNDER_SPEECH_DB = -11;
const IN_PAUSES_DB = -5;
const END_SCREEN_DB = -1;
// Only pauses at least this long let the music rise, so it doesn't pump between
// sentences.
const PAUSE_SECONDS = 1.0;
// How fast the music ducks before the narrator speaks, and comes back after.
const DUCK_SECONDS = 0.3;
const RISE_SECONDS = 0.9;
// Crossfade between tracks, and the fade out at the very end.
const CROSSFADE = 3;
const FINAL_FADE = 5;
// The envelope's resolution: 100 steps a second.
const CONTROL = 100;

const Plan = z.object({
  parts: z.array(z.object({ part: z.number().int(), mood: z.string(), why: z.string() })),
});

const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);

// ---- The library ------------------------------------------------------------

// A track's loudness, and how long it lasts up to its last sound: many end with
// a few seconds of silence, which a crossfade would turn into a dip.
function measure(path) {
  const err = spawnSync("ffmpeg", ["-nostdin", "-hide_banner", "-i", path, "-af", "silencedetect=n=-50dB:d=0.5,loudnorm=print_format=json", "-f", "null", "-"], {
    encoding: "utf8",
  }).stderr;
  const loud = JSON.parse(err.slice(err.lastIndexOf("{"), err.lastIndexOf("}") + 1));
  const length = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path]).toString());
  const starts = [...err.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...err.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  const trailing = starts.at(-1);
  // Silence that runs to the end of the file has no end, or ends with the file.
  const endsSilent = trailing !== undefined && (ends.length < starts.length || ends.at(-1) >= length - 0.1);
  return { duration: endsSilent ? trailing : length, loudness: Number(loud.input_i) };
}

// Every track in the library, with its mood, length and loudness. Measurements
// are kept in media/music/.index.json, so only new tracks are measured.
export function scanLibrary(root = LIBRARY) {
  if (!existsSync(root)) return [];
  const indexPath = join(root, ".index.json");
  const index = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, "utf8")) : {};
  const tracks = [];
  for (const folder of readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith("."))) {
    for (const name of readdirSync(join(root, folder.name)).filter((n) => AUDIO.test(n)).sort()) {
      const file = join(folder.name, name);
      const { size, mtimeMs } = statSync(join(root, file));
      const id = `3|${size}|${mtimeMs}`;
      if (index[file]?.id !== id) index[file] = { id, ...measure(join(root, file)) };
      const creditPath = join(root, folder.name, name.replace(AUDIO, ".txt"));
      tracks.push({
        file,
        mood: folder.name.toLowerCase(),
        title: name.replace(AUDIO, ""),
        duration: index[file].duration,
        loudness: index[file].loudness,
        credit: existsSync(creditPath) ? readFileSync(creditPath, "utf8").trim() : null,
      });
    }
  }
  writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);
  return tracks.filter((t) => t.duration >= MIN_TRACK_SECONDS && Number.isFinite(t.loudness));
}

// ---- Which mood where -------------------------------------------------------

async function chooseMoods(video, parts, moods, cached) {
  const instructions = prompt("music", { title: video.title, moods: moods.join(", "), parts: "" });
  const key = hash([parts.map((p) => [p.name, p.text]), moods, instructions]);
  if (cached?.key === key) return { key, moods: cached.moods, fresh: false };
  const listing = parts.map((p, i) => `## Part ${i + 1}: ${p.name} (${clock(p.start)} to ${clock(p.end)})\n${p.text}`).join("\n\n");
  const reply = await ask({
    label: "music moods",
    effort: "medium",
    maxTokens: 8000,
    system: "You choose background music for a faceless YouTube channel of case studies on how the world really works.",
    user: prompt("music", {
      title: video.title,
      moods: moods.map((m) => `- ${m}: ${MOODS[m] ?? "as the name says"}`).join("\n"),
      parts: listing,
    }),
    format: betaZodOutputFormat(Plan),
  });
  const picked = new Map(Plan.parse(JSON.parse(reply)).parts.map((p) => [p.part, p]));
  const result = [];
  for (const [i, part] of parts.entries()) {
    const choice = picked.get(i + 1);
    const ok = choice && (choice.mood === "none" || moods.includes(choice.mood));
    // An unknown mood keeps the previous part's music going.
    result.push({ part: part.name, mood: ok ? choice.mood : (result.at(-1)?.mood ?? moods[0]), why: choice?.why ?? "" });
  }
  return { key, moods: result, fresh: true };
}

// ---- Which track where ------------------------------------------------------

// Stretches of one mood, then the tracks that play in each: { track, at, length,
// fadeIn, fadeOut } with times in seconds from the start of the video.
function placeTracks(parts, moods, tracks, length, seed) {
  const cuts = parts.map((p, i) => (i === 0 ? 0 : (parts[i - 1].end + p.start) / 2));
  const stretches = [];
  for (const [i, m] of moods.entries()) {
    const to = cuts[i + 1] ?? length;
    if (stretches.at(-1)?.mood === m.mood) stretches.at(-1).to = to;
    else stretches.push({ mood: m.mood, from: cuts[i], to });
  }
  const uses = new Map();
  const order = (pool) =>
    [...pool].sort((a, b) => (uses.get(a.file) ?? 0) - (uses.get(b.file) ?? 0) || hash([seed, a.file]).localeCompare(hash([seed, b.file])));
  const clips = [];
  let previous = null;
  for (const [s, stretch] of stretches.entries()) {
    if (stretch.mood === "none") {
      previous = null;
      continue;
    }
    const first = s === 0;
    const last = s === stretches.length - 1;
    // Neighbouring stretches overlap by half a crossfade either side of the cut.
    const from = first ? 0 : stretch.from - CROSSFADE / 2;
    const to = last ? length : stretch.to + CROSSFADE / 2;
    const pool = tracks.filter((t) => t.mood === stretch.mood);
    // Enough plays to fill the stretch, all the same length, so none is a short
    // scrap at the end; a play that stops before its track ends fades out.
    const shortest = Math.min(...pool.map((t) => t.duration));
    const plays = Math.max(1, Math.ceil((to - from - CROSSFADE) / (shortest - CROSSFADE)));
    const each = (to - from + (plays - 1) * CROSSFADE) / plays;
    for (let k = 0; k < plays; k++) {
      const track = order(pool).find((t) => t.file !== previous?.file) ?? pool[0];
      const ends = k === plays - 1;
      clips.push({
        track,
        at: from + k * (each - CROSSFADE),
        length: each,
        fadeIn: first && k === 0 ? 1.5 : CROSSFADE,
        fadeOut: ends && last ? FINAL_FADE : CROSSFADE,
      });
      uses.set(track.file, (uses.get(track.file) ?? 0) + 1);
      previous = track;
    }
  }
  return clips;
}

// ---- The sound --------------------------------------------------------------

// How loud the music is at each moment, in dB, CONTROL steps a second: down
// while the narrator talks, up in longer pauses, highest under the end screen.
function envelope(words, length) {
  const steps = Math.ceil(length * CONTROL) + 1;
  const target = new Float32Array(steps).fill(IN_PAUSES_DB);
  let span = null;
  const spans = [];
  for (const w of words) {
    if (span && w.start - span.end < PAUSE_SECONDS) span.end = w.end;
    else spans.push((span = { start: w.start, end: w.end }));
  }
  for (const s of spans) {
    for (let k = Math.floor(s.start * CONTROL); k <= Math.min(steps - 1, Math.ceil((s.end + 0.2) * CONTROL)); k++) target[k] = UNDER_SPEECH_DB;
  }
  const spokenEnd = (words.at(-1)?.end ?? 0) + 0.6;
  for (let k = Math.ceil(spokenEnd * CONTROL); k < steps; k++) target[k] = END_SCREEN_DB;
  // Rises are slow and start after the pause begins; falls finish as speech starts.
  const range = IN_PAUSES_DB - UNDER_SPEECH_DB;
  const up = range / (RISE_SECONDS * CONTROL);
  const down = range / (DUCK_SECONDS * CONTROL);
  const level = Float32Array.from(target);
  for (let k = 1; k < steps; k++) level[k] = Math.min(target[k], level[k - 1] + up);
  for (let k = steps - 2; k >= 0; k--) level[k] = Math.min(level[k], level[k + 1] + down);
  return level;
}

function stereoWav(samples) {
  const header = Buffer.alloc(44);
  const bytes = samples.length * 2;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + bytes, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(bytes, 40);
  return Buffer.concat([header, Buffer.from(samples.buffer, samples.byteOffset, bytes)]);
}

function mixDown(clips, words, length, root, outPath) {
  const total = Math.ceil(length * RATE);
  const mix = new Float32Array(total * 2);
  for (const clip of clips) {
    const raw = execFileSync(
      "ffmpeg",
      ["-nostdin", "-v", "error", "-t", clip.length.toFixed(3), "-i", join(root, clip.track.file), "-f", "s16le", "-ac", "2", "-ar", String(RATE), "-"],
      { maxBuffer: 1 << 30 },
    );
    const pcm = new Int16Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length - (raw.length % 4)));
    const gain = 10 ** ((TRACK_LUFS - clip.track.loudness) / 20) / 32768;
    const start = Math.round(clip.at * RATE);
    const frames = pcm.length / 2;
    for (let i = 0; i < frames; i++) {
      const pos = start + i;
      if (pos >= total) break;
      const t = i / RATE;
      let g = gain;
      if (t < clip.fadeIn) g *= Math.sin(((t / clip.fadeIn) * Math.PI) / 2);
      const left = clip.length - t;
      if (left < clip.fadeOut) g *= Math.sin((Math.max(0, left / clip.fadeOut) * Math.PI) / 2);
      mix[pos * 2] += pcm[i * 2] * g;
      mix[pos * 2 + 1] += pcm[i * 2 + 1] * g;
    }
  }
  const level = envelope(words, length);
  const out = new Int16Array(total * 2);
  for (let i = 0; i < total; i++) {
    const c = (i / RATE) * CONTROL;
    const k = Math.floor(c);
    const db = level[k] + (level[Math.min(k + 1, level.length - 1)] - level[k]) * (c - k);
    const g = 10 ** (db / 20) * 32767;
    out[i * 2] = Math.max(-32768, Math.min(32767, Math.round(mix[i * 2] * g)));
    out[i * 2 + 1] = Math.max(-32768, Math.min(32767, Math.round(mix[i * 2 + 1] * g)));
  }
  writeFileSync(outPath, stereoWav(out));
}

// The narration and music together, without the picture, to listen to before
// rendering. Returns its loudness in LUFS.
export function previewMix(dir, timing, outPath) {
  execFileSync("ffmpeg", [
    "-nostdin", "-v", "error", "-y",
    "-i", join(dir, timing.audio),
    "-i", join(dir, "music.wav"),
    "-filter_complex", "[0:a]pan=stereo|c0=c0|c1=c0[v];[v][1:a]amix=inputs=2:normalize=0:duration=longest",
    "-c:a", "aac", "-b:a", "192k", outPath,
  ]);
  const err = spawnSync("ffmpeg", ["-nostdin", "-hide_banner", "-i", outPath, "-af", "loudnorm=print_format=json", "-f", "null", "-"], { encoding: "utf8" }).stderr;
  return Number(JSON.parse(err.slice(err.lastIndexOf("{"), err.lastIndexOf("}") + 1)).input_i);
}

// Builds music.wav for a video `length` seconds long (the end screen included).
// Returns { clips, moods, credits }, or null when the library is empty.
export async function prepareMusic(video, dir, { plan, timing, length, root = LIBRARY }) {
  const tracks = scanLibrary(root);
  if (!tracks.length) {
    console.log(`No music yet: put tracks in media/music/<mood>/ (${Object.keys(MOODS).join(", ")}). Rendering without it.`);
    return null;
  }
  const moodsAvailable = [...new Set(tracks.map((t) => t.mood))].sort();
  const parts = partsOf(plan, timing);
  const jsonPath = join(dir, "music.json");
  const cached = existsSync(jsonPath) ? JSON.parse(readFileSync(jsonPath, "utf8")) : null;
  const { key, moods } = await chooseMoods(video, parts, moodsAvailable, cached);
  const clips = placeTracks(parts, moods, tracks, length, video.slug);
  const sound = hash([clips.map((c) => [c.track.file, c.track.duration, c.at, c.length]), timing.voicedAt, length, [TRACK_LUFS, UNDER_SPEECH_DB, IN_PAUSES_DB, END_SCREEN_DB]]);
  const wavPath = join(dir, "music.wav");
  if (cached?.sound !== sound || !existsSync(wavPath)) {
    console.log(`Mixing the music: ${clips.length} track plays over ${clock(length)}...`);
    mixDown(clips, timing.words, length, root, wavPath);
  }
  const credits = [...new Set(clips.map((c) => c.track.credit).filter(Boolean))];
  const result = {
    key,
    sound,
    moods,
    clips: clips.map((c) => ({ at: Math.round(c.at * 10) / 10, length: Math.round(c.length * 10) / 10, mood: c.track.mood, track: c.track.title, file: c.track.file })),
    credits,
  };
  writeFileSync(jsonPath, `${JSON.stringify(result, null, 2)}\n`);
  const changes = moods.filter((m, i) => i === 0 || m.mood !== moods[i - 1].mood);
  console.log(`  Music: ${changes.map((m) => m.mood).join(" → ")} (${new Set(clips.map((c) => c.track.file)).size} tracks)`);
  return result;
}
