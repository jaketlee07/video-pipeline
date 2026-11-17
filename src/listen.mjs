// Narration check: Whisper (whisper.cpp, run on this Mac, free) writes down what
// the narrator actually said, and that is lined up against the script word by word.
// ElevenLabs' timings are for the text it was given, so on their own they can't
// show a misread number or name, a skipped word or a garbled stretch; this can.
// Most differences are only Whisper writing a word its own way ("Kimble", "1%"),
// so Claude sorts them, and only the ones worth hearing are listed, with times.
//
//   npm run listen                 the row with Status "Approved"
//   npm run listen -- walmart      the row with "walmart" in its title
//
// npm run voice runs this at the end too. Writes media/<slug>/listen.json.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { ask, prompt, totalSpent } from "./claude.mjs";

const MODEL_NAME = "ggml-large-v3-turbo-q5_0.bin";
const MODEL_URL = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${MODEL_NAME}`;
const CACHE_DIR = fileURLToPath(new URL("../media/.cache/whisper/", import.meta.url));
// Differences closer together than this many matching words are one stretch.
const JOIN_GAP = 2;
// Words of script shown either side of a difference.
const CONTEXT = 4;
// Each clip to listen to starts this long before the difference.
const CLIP_BEFORE = 2.5;
const CLIP_LENGTH = 7;

const Verdicts = z.object({
  items: z.array(
    z.object({
      id: z.number().int(),
      verdict: z.enum(["misread", "unsure", "fine"]),
      note: z.string(),
    }),
  ),
});

const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

// ---- Words to comparable tokens ---------------------------------------------

const ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split(" ");
const TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split(" ");
function hundreds(n) {
  const [h, r] = [Math.floor(n / 100), n % 100];
  const out = h ? [ONES[h], "hundred"] : [];
  if (r >= 20) out.push(TENS[Math.floor(r / 10)], ...(r % 10 ? [ONES[r % 10]] : []));
  else if (r || !h) out.push(ONES[r]);
  return out;
}
function spell(n) {
  if (n === 0) return ["zero"];
  const out = [];
  for (const [size, name] of [[1e12, "trillion"], [1e9, "billion"], [1e6, "million"], [1e3, "thousand"]]) {
    if (n >= size) {
      out.push(...hundreds(Math.floor(n / size)), name);
      n %= size;
    }
  }
  return n ? [...out, ...hundreds(n)] : out;
}
// Years as people say them: "nineteen eighty-four", "two thousand five", "twenty sixteen".
function year(n) {
  if (n >= 2000 && n < 2010) return spell(n);
  const [hi, lo] = [Math.floor(n / 100), n % 100];
  return [...hundreds(hi), ...(lo === 0 ? ["hundred"] : lo < 10 ? ["oh", ONES[lo]] : hundreds(lo))];
}

const SCALES = new Set(["thousand", "million", "billion", "trillion"]);

// One written word (as the script or Whisper has it) as lowercase spoken tokens.
export function tokens(word) {
  let w = word.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”"]/g, "");
  const out = [];
  const dollars = /\$/.test(w);
  const percent = /%/.test(w);
  w = w.replace(/[$%]/g, "").replace(/&/g, " and ");
  for (let part of w.split(/[\s—–\-/]+/)) {
    part = part.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
    if (!part) continue;
    const num = part.replace(/,/g, "");
    if (/^\d+$/.test(num)) {
      const n = Number(num);
      out.push(...(num.length === 4 && !part.includes(",") && n >= 1100 && n < 2100 ? year(n) : spell(n)));
    } else if (/^\d+\.\d+$/.test(num)) {
      const [whole, frac] = num.split(".");
      out.push(...spell(Number(whole)), "point", ...[...frac].map((d) => ONES[Number(d)]));
    } else if (/^\d{4}s$/.test(part)) {
      // A decade: "1990s" → "nineteen nineties".
      const said = year(Number(part.slice(0, 4)));
      out.push(...said.slice(0, -1), `${said.at(-1).replace(/y$/, "ie")}s`);
    } else if (/^\d+(st|nd|rd|th|s)$/.test(part)) {
      out.push(...spell(Number(part.match(/^\d+/)[0])), part.replace(/^\d+/, ""));
    } else {
      // "Town 'n Country" is said "Town and Country".
      out.push(part === "n" ? "and" : part.replace(/['.]/g, ""));
    }
  }
  if (percent) out.push("percent");
  if (dollars) out.push("dollars");
  return out.filter(Boolean);
}

// ---- Whisper ----------------------------------------------------------------

function whisperInstalled() {
  try {
    execFileSync("whisper-cli", ["--help"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function modelPath() {
  const path = join(CACHE_DIR, MODEL_NAME);
  if (existsSync(path)) return path;
  mkdirSync(CACHE_DIR, { recursive: true });
  console.log(`Downloading Whisper's speech model once (${MODEL_NAME}, 574 MB)...`);
  const res = await fetch(MODEL_URL);
  if (!res.ok) throw new Error(`Couldn't download the Whisper model: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(`${path}.part`));
  renameSync(`${path}.part`, path);
  return path;
}

// Names in the script, given to Whisper so it spells them the script's way and
// only a name that was said differently shows up as a difference.
function namesIn(text) {
  const names = new Set();
  for (const sentence of text.split(/(?<=[.?!])\s+|\n+/)) {
    for (const word of sentence.split(/\s+/).slice(1)) {
      const clean = word.replace(/^[^A-Za-z]+|[^A-Za-z'’]+$/g, "").replace(/['’]s$/, "");
      if (/^[A-Z][a-z]/.test(clean)) names.add(clean);
    }
  }
  return [...names].slice(0, 80).join(", ");
}

// Whisper's words, each with its start and end in seconds. Cached by the audio's
// contents, so a rerun after only the Claude step changed takes no time.
async function transcribe(audioPath, script) {
  const audio = readFileSync(audioPath);
  const key = createHash("sha256").update(audio).update(MODEL_NAME).digest("hex").slice(0, 16);
  const cached = join(CACHE_DIR, `${key}.json`);
  if (existsSync(cached)) return JSON.parse(readFileSync(cached, "utf8"));
  const model = await modelPath();
  const work = join(tmpdir(), `video-pipeline-listen-${process.pid}`);
  mkdirSync(work, { recursive: true });
  try {
    const wav16 = join(work, "audio.wav");
    execFileSync("ffmpeg", ["-nostdin", "-v", "error", "-y", "-i", audioPath, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav16]);
    const started = Date.now();
    console.log("Transcribing the narration with Whisper on this Mac...");
    execFileSync(
      "whisper-cli",
      ["-m", model, "-f", wav16, "-l", "en", "-t", "8", "-ml", "1", "-sow", "-oj", "-of", join(work, "out"), "-np", "--prompt", namesIn(script), "--carry-initial-prompt"],
      { stdio: ["ignore", "ignore", "pipe"], maxBuffer: 1 << 28 },
    );
    console.log(`  done in ${Math.round((Date.now() - started) / 1000)} s`);
    const raw = JSON.parse(readFileSync(join(work, "out.json"), "utf8"));
    const words = raw.transcription
      .map((s) => ({ text: s.text.trim(), start: s.offsets.from / 1000, end: s.offsets.to / 1000 }))
      .filter((w) => w.text && !/^\[.*\]$/.test(w.text));
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(cached, JSON.stringify(words));
    return words;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// ---- Lining up the two ------------------------------------------------------

// Longest common subsequence of two token lists, as a list of steps: "same",
// "missed" (in the script, not heard) and "extra" (heard, not in the script).
function align(a, b) {
  const [n, m] = [a.length, b.length];
  const w = m + 1;
  const lcs = new Uint16Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * w + j] = a[i].t === b[j].t ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
    }
  }
  const steps = [];
  let [i, j] = [0, 0];
  while (i < n || j < m) {
    if (i < n && j < m && a[i].t === b[j].t) steps.push({ kind: "same", a: i++, b: j++ });
    else if (j < m && (i === n || lcs[i * w + j + 1] >= lcs[(i + 1) * w + j])) steps.push({ kind: "extra", b: j++ });
    else steps.push({ kind: "missed", a: i++ });
  }
  return steps;
}

// Stretches where what was heard differs from the script, with the script words
// and heard words involved, and the time in the narration.
function differences(scriptWords, heardWords) {
  const flat = (words) => {
    const list = words.flatMap((w, i) => tokens(w.text).map((t) => ({ t, word: i })));
    // "$92 million" is said "92 million dollars".
    for (let i = 0; i < list.length - 1; i++) {
      if (list[i].t === "dollars" && SCALES.has(list[i + 1].t)) [list[i].t, list[i + 1].t] = [list[i + 1].t, "dollars"];
    }
    return list;
  };
  const a = flat(scriptWords);
  const b = flat(heardWords);
  const steps = align(a, b);
  const runs = [];
  let run = null;
  let sameSince = Infinity;
  for (const step of steps) {
    if (step.kind === "same") {
      sameSince++;
      continue;
    }
    if (!run || sameSince > JOIN_GAP) {
      run = { steps: [] };
      runs.push(run);
    }
    run.steps.push(step);
    sameSince = 0;
  }
  // Where in the script each step sits, for runs that only have extra words.
  let lastScript = 0;
  const scriptPos = new Map();
  for (const step of steps) {
    if (step.a !== undefined) lastScript = a[step.a].word;
    scriptPos.set(step, lastScript);
  }
  return runs.map((r, k) => {
    const sIdx = r.steps.filter((s) => s.a !== undefined).map((s) => a[s.a].word);
    const hIdx = r.steps.filter((s) => s.b !== undefined).map((s) => b[s.b].word);
    const [s0, s1] = sIdx.length ? [Math.min(...sIdx), Math.max(...sIdx)] : [scriptPos.get(r.steps[0]) + 1, scriptPos.get(r.steps[0])];
    const excerpt = (words, from, to) => {
      const before = words.slice(Math.max(0, from - CONTEXT), from).map((w) => w.text);
      const inside = words.slice(from, to + 1).map((w) => w.text);
      const after = words.slice(to + 1, to + 1 + CONTEXT).map((w) => w.text);
      return [...before, inside.length ? `«${inside.join(" ")}»` : "«(nothing)»", ...after].join(" ");
    };
    const at = scriptWords[Math.min(s0, scriptWords.length - 1)].start;
    return {
      id: k + 1,
      at,
      script: excerpt(scriptWords, s0, s1),
      heard: hIdx.length ? excerpt(heardWords, Math.min(...hIdx), Math.max(...hIdx)) : "(nothing heard here)",
      // The difference in spoken words, which is what the verdict is about.
      said: {
        script: r.steps.filter((s) => s.a !== undefined).map((s) => a[s.a].t).join(" "),
        heard: r.steps.filter((s) => s.b !== undefined).map((s) => b[s.b].t).join(" "),
      },
      missed: sIdx.length ? scriptWords.slice(s0, s1 + 1).map((w) => w.text).join(" ") : "",
      extra: hIdx.length ? heardWords.slice(Math.min(...hIdx), Math.max(...hIdx) + 1).map((w) => w.text).join(" ") : "",
    };
  });
}

// ---- The check --------------------------------------------------------------

// Returns the stretches worth listening to, and writes listen.json.
export async function checkNarration(video, dir) {
  if (!whisperInstalled()) {
    console.log("\nNarration check skipped: Whisper isn't installed. Install it with: brew install whisper-cpp");
    return null;
  }
  const timing = JSON.parse(readFileSync(join(dir, "timing.json"), "utf8"));
  const script = readFileSync(join(dir, "narration.txt"), "utf8");
  const heard = await transcribe(join(dir, timing.audio), script);
  const found = differences(timing.words, heard);
  const sceneAt = (seconds) => timing.scenes.find((s) => seconds >= s.start && seconds < s.end)?.id ?? timing.scenes.at(-1).id;

  let verdicts = new Map();
  if (found.length) {
    const listing = found.map((d) => `#${d.id} at ${clock(d.at)}\n  script: ${d.script}\n  heard:  ${d.heard}\n  in spoken words, the script has "${d.said.script || "(nothing)"}" where the transcript has "${d.said.heard || "(nothing)"}"`).join("\n\n");
    const reply = await ask({
      label: "narration check",
      effort: "medium",
      maxTokens: 16000,
      system: "You proof-listen narration for a faceless YouTube channel about the hidden economics of everyday things.",
      user: prompt("listen", { title: video.title, count: String(found.length), differences: listing }),
      format: betaZodOutputFormat(Verdicts),
    });
    verdicts = new Map(Verdicts.parse(JSON.parse(reply)).items.map((v) => [v.id, v]));
  }
  const results = found.map((d) => ({
    ...d,
    at: Math.round(d.at * 10) / 10,
    scene: sceneAt(d.at),
    verdict: verdicts.get(d.id)?.verdict ?? "unsure",
    note: verdicts.get(d.id)?.note ?? "",
  }));

  const flagged = results.filter((r) => r.verdict !== "fine");
  // A short clip of each, to play rather than scrub for.
  const clipDir = join(dir, "listen");
  rmSync(clipDir, { recursive: true, force: true });
  if (flagged.length) mkdirSync(clipDir);
  for (const r of flagged) {
    r.clip = `listen/${clock(r.at).replace(":", "m")}s-scene-${r.scene}.m4a`;
    const from = Math.max(0, r.at - CLIP_BEFORE);
    execFileSync("ffmpeg", ["-nostdin", "-v", "error", "-y", "-ss", String(from), "-t", String(CLIP_LENGTH), "-i", join(dir, timing.audio), "-c:a", "aac", "-b:a", "128k", join(dir, r.clip)]);
  }
  writeFileSync(
    join(dir, "listen.json"),
    `${JSON.stringify({ title: video.title, checkedAt: new Date().toISOString(), audio: timing.audio, scriptWords: timing.words.length, heardWords: heard.length, differences: results }, null, 2)}\n`,
  );
  console.log(
    `\nNarration check: Whisper heard ${heard.length.toLocaleString("en-US")} words against the script's ${timing.words.length.toLocaleString("en-US")}. ` +
      `${results.length} differences, ${results.length - flagged.length} of them only how Whisper wrote a word.`,
  );
  if (!flagged.length) console.log("  Nothing to listen to: the narration matches the script.");
  else {
    console.log(`  Listen to ${flagged.length === 1 ? "this one" : `these ${flagged.length}`} (time in the narration):`);
    for (const r of flagged) {
      console.log(`  ${clock(r.at).padStart(5)}  scene ${r.scene}  ${r.verdict === "misread" ? "likely misread" : "unsure"}: ${r.note}`);
      console.log(`         script: ${r.script}\n         heard:  ${r.heard}\n         play:   open "media/${video.slug}/${r.clip}"`);
    }
  }
  console.log(`  Saved: media/${video.slug}/listen.json`);
  return flagged;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { findVideo } = await import("./notion.mjs");
  const { videoDir } = await import("./paths.mjs");
  const query = process.argv.slice(2).filter((a) => !a.startsWith("--")).join(" ") || undefined;
  try {
    const video = await findVideo(query, "Approved");
    const dir = videoDir(video.slug);
    if (!existsSync(join(dir, "timing.json"))) throw new Error(`"${video.title}" isn't narrated yet. Run npm run voice first.`);
    await checkNarration(video, dir);
    console.log(`  Claude cost: about $${totalSpent().toFixed(2)}`);
  } catch (err) {
    console.error(`\n${err.message}`);
    process.exit(1);
  }
}
