// The channel's music library: instrumental tracks composed once by ElevenLabs
// Music and reused by every video (src/music.mjs picks among them by mood).
// Tracks already in media/music/ are kept, so this only composes missing ones:
// delete a track you don't like and run it again for a new take.
//
//   npm run music:library
//
// Then listen to media/music/sampler.m4a: ten seconds of each track, in order.
// ElevenLabs' music terms on the Creator plan allow commercial use online with no
// credit. YouTube asks for its "altered or synthetic content" box to be ticked on
// upload for AI music; that doesn't affect monetization.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MUSIC_MODEL, compose } from "./elevenlabs.mjs";
import { LIBRARY, scanLibrary } from "./music.mjs";

const SECONDS = 150;
// At once: the Creator plan allows 2 requests in parallel.
const AT_ONCE = 2;
// Every description ends the same way, so each track leaves room for the voice.
const UNDER_VOICE = "No lead melody, no vocals, no big drops or drum fills; made to sit quietly under a narrator's voice. Instrumental.";

export const TRACKS = {
  curious: [
    ["paper-trail", "Light, curious documentary underscore. Pizzicato strings, soft marimba and felt piano, steady mid tempo around 100 BPM, playful but restrained."],
    ["receipt", "Minimal electronic explainer bed. Soft plucked synth arpeggio, warm pad, light brushed percussion, 95 BPM, inquisitive and steady, sparse."],
    ["main-street", "Gentle, curious underscore. Acoustic guitar harmonics, glockenspiel and soft upright bass, 90 BPM, warm and thoughtful, sparse arrangement."],
  ],
  tense: [
    ["undertow", "Dark, tense documentary underscore. Low sustained cello drones, pulsing synth bass at 80 BPM, soft ticking percussion, slowly building suspense."],
    ["ledger", "Ominous investigative score. Deep piano notes, muted string ostinato, subtle heartbeat kick, cold atmosphere, steady tension without big hits."],
    ["fault-line", "Brooding minimal electronic tension bed. Dark analog pad, low pulsing bass, distant metallic textures, 85 BPM, restrained and uneasy."],
  ],
  somber: [
    ["empty-lot", "Slow, reflective documentary underscore. Sparse felt piano, soft string pad, gentle and sad, 65 BPM, lots of space, no crescendos."],
    ["closing-time", "Melancholy ambient bed. Warm cello and viola long notes, quiet piano, the feeling of an empty small town, slow and still."],
    ["last-shift", "Somber acoustic underscore. Fingerpicked acoustic guitar, soft ambient pad, slow 70 BPM, quiet and wistful, minimal."],
  ],
  hopeful: [
    ["new-ground", "Warm, hopeful documentary underscore. Gentle piano chords, slowly rising strings, soft pulsing synth, 90 BPM, uplifting but restrained."],
    ["reopening", "Optimistic ambient bed. Bright plucked guitar, warm pads, light shaker, 100 BPM, steady and positive, sparse."],
    ["way-forward", "Quietly hopeful closing theme. Piano and strings, a slow build to a warm resolution, 80 BPM, cinematic but understated."],
  ],
};

// Ten seconds from the middle of each track, one after another, with a list of
// what plays when. Returns the list.
function sampler(root) {
  const tracks = scanLibrary(root);
  const work = join(tmpdir(), `video-pipeline-sampler-${process.pid}`);
  mkdirSync(work, { recursive: true });
  try {
    const parts = tracks.map((t, i) => {
      const out = join(work, `${String(i).padStart(2, "0")}.wav`);
      const from = Math.max(0, t.duration / 2 - 5);
      const gain = -20 - t.loudness;
      execFileSync("ffmpeg", ["-nostdin", "-v", "error", "-y", "-ss", from.toFixed(2), "-t", "10", "-i", join(root, t.file), "-af", `volume=${gain.toFixed(1)}dB,afade=t=in:d=0.3,afade=t=out:st=9.4:d=0.6`, "-ar", "44100", "-ac", "2", out]);
      return out;
    });
    writeFileSync(join(work, "list.txt"), parts.map((p) => `file '${p}'`).join("\n"));
    execFileSync("ffmpeg", ["-nostdin", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", join(work, "list.txt"), "-c:a", "aac", "-b:a", "192k", join(root, "sampler.m4a")]);
    return tracks.map((t, i) => `  ${String(i * 10 / 60 | 0)}:${String((i * 10) % 60).padStart(2, "0")}  ${t.file}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

async function main() {
  const madePath = join(LIBRARY, ".made.json");
  const made = existsSync(madePath) ? JSON.parse(readFileSync(madePath, "utf8")) : {};
  const todo = Object.entries(TRACKS).flatMap(([mood, list]) =>
    list.map(([name, description], i) => ({ mood, file: join(mood, `${i + 1}-${name}.mp3`), prompt: `${description} ${UNDER_VOICE}` })).filter((t) => !existsSync(join(LIBRARY, t.file))),
  );
  console.log(todo.length ? `Composing ${todo.length} tracks of ${SECONDS / 60} minutes with ElevenLabs Music...` : "Every track is already composed.");
  const failed = [];
  for (let i = 0; i < todo.length; i += AT_ONCE) {
    await Promise.all(
      todo.slice(i, i + AT_ONCE).map(async (t) => {
        try {
          const { audio, songId } = await compose({ prompt: t.prompt, seconds: SECONDS });
          mkdirSync(join(LIBRARY, t.mood), { recursive: true });
          writeFileSync(join(LIBRARY, t.file), audio);
          made[t.file] = { prompt: t.prompt, model: MUSIC_MODEL, songId, madeAt: new Date().toISOString() };
          console.log(`  ${t.file}`);
        } catch (err) {
          failed.push(`${t.file}: ${err.message}`);
        }
      }),
    );
    writeFileSync(madePath, `${JSON.stringify(made, null, 2)}\n`);
  }
  if (failed.length) console.log(`\nCouldn't compose ${failed.length}:\n  ${failed.join("\n  ")}\nRun this again to retry them.`);
  const list = sampler(LIBRARY);
  console.log(`
Done: ${list.length} tracks in media/music/ (${todo.length - failed.length} new, about ${Math.round(((todo.length - failed.length) * SECONDS) / 60)} minutes of music composed).
  Sampler, ten seconds of each:
${list.join("\n")}
  Listen: open media/music/sampler.m4a
  To replace one, delete its file and run this again.`);
}

main().catch((err) => {
  console.error(`\n${err.message}`);
  process.exit(1);
});
