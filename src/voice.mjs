// Narration (guide stage 5): the narrator reads the approved script one paragraph
// per request, and ElevenLabs' character timings give every sentence, word and
// scene its start and end in the audio. Writes media/<slug>/narration.wav and
// timing.json.
//
//   npm run voice                      the row with Status "Approved"
//   npm run voice -- walmart           the row with "walmart" in its title
//   npm run voice -- walmart --sample  just the first three paragraphs, to sample.wav
//
// Each paragraph's audio is kept in media/<slug>/voice/, so a rerun only pays for
// paragraphs that are new or changed.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { VOICE_MODEL, speak, voiceId } from "./elevenlabs.mjs";
import { findVideo, getMarkdown, pageSection } from "./notion.mjs";
import { videoDir } from "./paths.mjs";
import { parseScript, splitSentences } from "./script.mjs";

const args = process.argv.slice(2);
const force = args.includes("--force");
const sample = args.includes("--sample");
const query = args.filter((a) => !a.startsWith("--")).join(" ") || undefined;

const SAMPLE_RATE = 44100;
const SAMPLE_PARAGRAPHS = 3;
// Silence between paragraphs, and between parts of the script, in seconds.
const PARAGRAPH_PAUSE = 0.35;
const PART_PAUSE = 0.8;
// ElevenLabs only stitches onto requests under two hours old.
const STITCH_MAX_AGE_MS = 110 * 60 * 1000;

const round = (seconds) => Math.round(seconds * 1000) / 1000;
const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;

// Decodes an MP3 to 16-bit mono PCM at SAMPLE_RATE.
const decode = (file) =>
  execFileSync("ffmpeg", ["-v", "error", "-i", file, "-f", "s16le", "-ac", "1", "-ar", String(SAMPLE_RATE), "-"], {
    maxBuffer: 1 << 30,
  });
const silence = (seconds) => Buffer.alloc(Math.round(seconds * SAMPLE_RATE) * 2);

// 16-bit mono PCM as a WAV file.
function wav(pcm) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
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
  const paragraphs = readFileSync(join(dir, "narration.txt"), "utf8").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

  // The audio has to match what the scenes were planned on, and what's on the page.
  const sentences = splitSentences(paragraphs.map((text) => ({ part: null, text })));
  if (sentences.map((s) => s.text).join("\n") !== plan.sentences.map((s) => s.text).join("\n")) {
    throw new Error("narration.txt and scenes.json don't match. Run npm run scenes again.");
  }
  const onPage = parseScript(pageSection(await getMarkdown(video.id), "Script") ?? "").map((p) => p.text);
  if (onPage.join("\n") !== paragraphs.join("\n")) {
    throw new Error("The script on the Notion page changed after its scenes were planned. Run npm run scenes again, then this.");
  }

  const voiceDir = join(dir, "voice");
  mkdirSync(voiceDir, { recursive: true });
  const chunks = paragraphs.map((text, i) => {
    const key = createHash("sha256").update(JSON.stringify([VOICE_MODEL, voiceId, text])).digest("hex").slice(0, 16);
    return {
      text,
      part: plan.sentences[sentences.findIndex((s) => s.paragraph === i)].part,
      audioPath: join(voiceDir, `${key}.mp3`),
      metaPath: join(voiceDir, `${key}.json`),
    };
  });
  const todo = sample ? chunks.slice(0, SAMPLE_PARAGRAPHS) : chunks;
  const meta = (chunk) => (existsSync(chunk.metaPath) ? JSON.parse(readFileSync(chunk.metaPath, "utf8")) : null);
  const voiced = (chunk) => existsSync(chunk.audioPath) && meta(chunk) !== null;

  const fresh = todo.filter((c) => !voiced(c)).length;
  console.log(
    `Narrating "${video.title}": ${todo.length} paragraphs${fresh < todo.length ? ` (${todo.length - fresh} already voiced)` : ""}, ` +
      `${todo.filter((c) => !voiced(c)).reduce((n, c) => n + c.text.length, 0).toLocaleString("en-US")} characters to voice...`,
  );
  let credits = 0;
  for (const [i, chunk] of todo.entries()) {
    if (voiced(chunk)) continue;
    // Stitch onto the paragraphs just before this one, if they were voiced recently.
    const previousRequestIds = [];
    for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
      const m = meta(chunks[j]);
      if (!m?.requestId || Date.now() - m.createdAt > STITCH_MAX_AGE_MS) break;
      previousRequestIds.unshift(m.requestId);
    }
    let result;
    try {
      result = await speak({ text: chunk.text, previousText: chunks[i - 1]?.text, nextText: chunks[i + 1]?.text, previousRequestIds });
    } catch (err) {
      const done = todo.filter(voiced).length;
      throw new Error(`${err.message}\n${done} of ${todo.length} paragraphs are voiced and saved; run this again to continue from paragraph ${i + 1}.`);
    }
    if (result.alignment?.characters.join("") !== chunk.text) throw new Error(`ElevenLabs' timings for paragraph ${i + 1} don't match its text.`);
    writeFileSync(chunk.audioPath, result.audio);
    writeFileSync(
      chunk.metaPath,
      `${JSON.stringify({ text: chunk.text, model: VOICE_MODEL, voiceId, requestId: result.requestId, createdAt: Date.now(), alignment: result.alignment })}\n`,
    );
    credits += result.credits;
    console.log(`  ${i + 1}/${todo.length} voiced (${result.credits} credits)`);
  }

  // Join the paragraphs with pauses, and place every sentence and word on the timeline.
  const audio = [];
  const timedSentences = [];
  const words = [];
  let time = 0;
  for (const [i, chunk] of todo.entries()) {
    if (i > 0) {
      const pause = silence(chunk.part === todo[i - 1].part ? PARAGRAPH_PAUSE : PART_PAUSE);
      audio.push(pause);
      time += pause.length / 2 / SAMPLE_RATE;
    }
    const pcm = decode(chunk.audioPath);
    const length = pcm.length / 2 / SAMPLE_RATE;
    // ElevenLabs' last timings can run a few hundredths of a second past the audio.
    const { character_start_times_seconds: starts, character_end_times_seconds: ends } = meta(chunk).alignment;
    const at = (seconds) => round(time + Math.min(seconds, length));
    let from = 0;
    for (const s of sentences.filter((x) => x.paragraph === i)) {
      const first = chunk.text.indexOf(s.text, from);
      if (first === -1) throw new Error(`Couldn't find sentence ${s.id} in its paragraph.`);
      from = first + s.text.length;
      timedSentences.push({ id: s.id, start: at(starts[first]), end: at(ends[from - 1]) });
      for (const w of s.text.matchAll(/\S+/g)) {
        const start = first + w.index;
        words.push({ text: w[0], sentence: s.id, start: at(starts[start]), end: at(ends[start + w[0].length - 1]) });
      }
    }
    audio.push(pcm);
    time += length;
  }
  const duration = round(time);
  const outName = sample ? "sample.wav" : "narration.wav";
  writeFileSync(join(dir, outName), wav(Buffer.concat(audio)));

  if (sample) {
    console.log(`\nSample: media/${video.slug}/sample.wav (${clock(duration)}). ElevenLabs credits used: ${credits.toLocaleString("en-US")}`);
    console.log(`Listen: open media/${video.slug}/sample.wav\nThe full run reuses these paragraphs.`);
    return;
  }

  // Each scene starts halfway through the pause before its first sentence.
  const sentenceTime = new Map(timedSentences.map((s) => [s.id, s]));
  const starts = plan.scenes.map((scene, i) => {
    if (i === 0) return 0;
    const first = sentenceTime.get(scene.sentences[0]);
    const before = sentenceTime.get(scene.sentences[0] - 1);
    return round((before.end + first.start) / 2);
  });
  const scenes = plan.scenes.map((scene, i) => ({ id: scene.id, start: starts[i], end: starts[i + 1] ?? duration }));

  writeFileSync(
    join(dir, "timing.json"),
    `${JSON.stringify(
      { title: video.title, slug: video.slug, voice: { id: voiceId, model: VOICE_MODEL }, voicedAt: new Date().toISOString(), audio: outName, duration, scenes, sentences: timedSentences, words },
      null,
      2,
    )}\n`,
  );

  const longest = scenes.reduce((a, b) => (b.end - b.start > a.end - a.start ? b : a));
  console.log(`
Done: "${video.title}" is narrated.
  Audio: media/${video.slug}/narration.wav (${clock(duration)})
  Paragraphs: ${chunks.length} (${fresh} newly voiced, ${chunks.length - fresh} reused)
  ElevenLabs credits used: ${credits.toLocaleString("en-US")}
  Timing: ${scenes.length} scenes, ${timedSentences.length} sentences and ${words.length} words; longest scene ${(longest.end - longest.start).toFixed(1)} s (scene ${longest.id})
  Saved: media/${video.slug}/timing.json
  Listen: open media/${video.slug}/narration.wav`);
}

main().catch((err) => {
  console.error(`\n${err.message}`);
  process.exit(1);
});
