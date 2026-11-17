// Wikimedia Commons and Internet Archive videos are often long and edited: a news
// piece cuts between the store, an interview and a reporter; an old industrial film
// runs a quarter of an hour. So the picker sees each candidate video as a sheet of
// numbered stills, one from each uninterrupted stretch long enough for the scene,
// and only the stretch it picks is downloaded, from the best encoding up to 1080p,
// with any black borders cropped off.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { agentFor } from "./commons.mjs";

const CACHE_DIR = fileURLToPath(new URL("../media/.cache/commons-video/", import.meta.url));
// Larger than this, a preview copy isn't worth downloading (20 minutes of the
// Internet Archive's smallest copy is about 90 MB).
const MAX_PREVIEW_BYTES = 100e6;
const SCENE_CHANGE = 0.3;
// Kept clear of each cut, so a stretch never starts or ends on a blend of two shots.
const EDGE = 0.3;
export const MAX_STILLS = 6;
const MAX_PER_SHOT = 4;
// A stretch can be slowed to fill a slightly longer scene (as in footage.mjs).
const MIN_LENGTH_SHARE = 0.75;

const ffmpeg = (args, options = {}) => execFileSync("ffmpeg", ["-hide_banner", "-nostdin", "-v", "error", ...args], { timeout: 180_000, ...options });

// The smallest encoding, downloaded once, and where its cuts are.
async function preview(video) {
  if (!video.pageid) throw new Error(`Video "${video.title}" has no page ID.`);
  mkdirSync(CACHE_DIR, { recursive: true });
  const small = video.encodings.find((e) => e.width >= 320) ?? video.encodings[0];
  const file = join(CACHE_DIR, `${video.pageid}-${small.width}.video`);
  const cutsFile = join(CACHE_DIR, `${video.pageid}-cuts.json`);
  if (!existsSync(file)) {
    const res = await fetch(small.url, { headers: { "User-Agent": agentFor(small.url) } }).catch(() => null);
    if (!res?.ok || Number(res.headers.get("content-length") ?? 0) > MAX_PREVIEW_BYTES) return null;
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  if (!existsSync(cutsFile)) {
    let out;
    try {
      out = ffmpeg(["-i", file, "-an", "-vf", `select='gt(scene,${SCENE_CHANGE})',metadata=print:file=-`, "-f", "null", "-"]).toString();
    } catch {
      return null;
    }
    const cuts = [...out.matchAll(/pts_time:([\d.]+)/g)].map((m) => Number(m[1]));
    writeFileSync(cutsFile, JSON.stringify(cuts));
  }
  return { file, cuts: JSON.parse(readFileSync(cutsFile, "utf8")) };
}

// Stretches without a cut, at least long enough for the scene (or its share when
// slowed), each up to a second longer than the scene. A long single shot (a drive
// around a mall) gives several stretches. At most `most`, spread over the video.
function stretches(duration, cuts, seconds, most) {
  const want = seconds + 1;
  const bounds = [0, ...cuts, duration];
  const found = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const [a, b] = [bounds[i] + EDGE, bounds[i + 1] - EDGE];
    const length = b - a;
    if (length < seconds * MIN_LENGTH_SHARE) continue;
    const count = Math.min(MAX_PER_SHOT, Math.max(1, Math.floor(length / want)));
    const each = Math.min(length, want);
    const gap = count > 1 ? (length - each) / (count - 1) : 0;
    for (let k = 0; k < count; k++) found.push({ start: a + k * gap, end: a + k * gap + each });
  }
  if (found.length <= most) return found;
  return Array.from({ length: most }, (_, i) => found[Math.round((i * (found.length - 1)) / (most - 1))]);
}

let sheets = 0;
// { image: base64 JPEG, windows: [{ start, end }] } with still N from window N, or
// null if the video can't be read or has no stretch long enough. A long film gets
// more stills (`most`), so the sheet still samples all of it.
export async function shotSheet(video, seconds, most = MAX_STILLS) {
  const p = await preview(video);
  if (!p) return null;
  const windows = stretches(video.videoLength, p.cuts, seconds, most);
  if (!windows.length) return null;
  const dir = join(tmpdir(), `video-pipeline-sheet-${process.pid}-${sheets++}`);
  mkdirSync(dir, { recursive: true });
  try {
    for (const [i, w] of windows.entries()) {
      const label = `drawtext=text='${i + 1}':x=10:y=8:fontsize=34:fontcolor=white:box=1:boxcolor=black@0.65:boxborderw=6`;
      const fit = "scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2";
      ffmpeg(["-ss", ((w.start + w.end) / 2).toFixed(2), "-i", p.file, "-frames:v", "1", "-vf", `${fit},${label}`, "-q:v", "4", join(dir, `${String(i + 1).padStart(2, "0")}.jpg`)]);
    }
    const cols = Math.min(windows.length > 6 ? 4 : 3, windows.length);
    const rows = Math.ceil(windows.length / cols);
    const image = ffmpeg(
      ["-framerate", "1", "-i", join(dir, "%02d.jpg"), "-vf", `tile=${cols}x${rows}:padding=6:color=black`, "-frames:v", "1", "-f", "image2", "-c:v", "mjpeg", "-q:v", "4", "-"],
      { stdio: ["ignore", "pipe", "ignore"] },
    ).toString("base64");
    return { image, windows };
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const H264 = ["-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart"];

// The part of the frame inside any black border, as [width, height, x, y] shares
// of it, or null when there's no border. Measured over the whole preview copy: a
// real border is there in every frame, while a dark shot's edges only look like
// one for a while. A box under half the frame isn't a border.
function border(file) {
  const saved = `${file}.border.json`;
  if (!existsSync(saved)) {
    const [width, height] = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", file], { encoding: "utf8" })
      .trim()
      .split(",")
      .map(Number);
    // cropdetect reports on stderr.
    const { stderr } = spawnSync("ffmpeg", ["-hide_banner", "-nostdin", "-i", file, "-an", "-vf", "cropdetect=limit=24:round=2:reset=0", "-f", "null", "-"], { encoding: "utf8", timeout: 180_000 });
    const [w, h, x, y] = stderr?.match(/crop=\d+:\d+:\d+:\d+/g)?.at(-1)?.slice(5).split(":").map(Number) ?? [width, height, 0, 0];
    writeFileSync(saved, JSON.stringify([w / width, h / height, x / width, y / height]));
  }
  const box = JSON.parse(readFileSync(saved, "utf8"));
  return (box[0] < 1 || box[1] < 1) && box[0] * box[1] > 0.5 ? box : null;
}

// Downloads just the chosen stretch, without sound, as H.264 at up to 1080p. Black
// borders (an old film transfer's edges, a 4:3 news clip boxed into 16:9) are
// cropped off, since the render fills the frame and would show them as bars, and
// stretched pixels (DVD-style 720×480) are made square.
export async function downloadStretch(pick, outPath) {
  const best = [...pick.encodings].reverse().find((e) => e.width <= 1920) ?? pick.encodings[0];
  const p = await preview(pick).catch(() => null);
  const box = p && border(p.file);
  const crop = box ? `crop=${box.map((share, i) => `${i % 2 ? "ih" : "iw"}*${share.toFixed(4)}`).join(":")},` : "";
  ffmpeg([
    "-user_agent", agentFor(best.url),
    "-ss", pick.start.toFixed(2),
    "-i", best.url,
    "-t", pick.duration.toFixed(2),
    "-vf", `${crop}scale='trunc(iw*sar/2)*2':'trunc(ih/2)*2',setsar=1`,
    ...H264,
    "-y", outPath,
  ]);
}
