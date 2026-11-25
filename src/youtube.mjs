// YouTube Data API v3 (https://developers.google.com/youtube/v3), for public video
// stats. Needs YOUTUBE_API_KEY in .env: a free key from console.cloud.google.com
// with "YouTube Data API v3" enabled. The free quota is 10,000 units a day and
// every call here costs 1, so answers are cached for a day in media/.cache/youtube/.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./env.mjs";

const env = loadEnv();
const CACHE_DIR = fileURLToPath(new URL("../media/.cache/youtube/", import.meta.url));
const DAY_MS = 24 * 60 * 60 * 1000;

export const hasYouTubeKey = () => Boolean(env.YOUTUBE_API_KEY);

export async function youtube(path, params) {
  if (!env.YOUTUBE_API_KEY) throw new Error("No YOUTUBE_API_KEY in .env (see .env.example).");
  const query = new URLSearchParams(params);
  const cachePath = join(CACHE_DIR, `${createHash("sha256").update(`${path}?${query}`).digest("hex").slice(0, 16)}.json`);
  if (existsSync(cachePath)) {
    const cached = JSON.parse(readFileSync(cachePath, "utf8"));
    if (Date.now() - cached.fetchedAt < DAY_MS) return cached.json;
  }
  query.set("key", env.YOUTUBE_API_KEY);
  let res;
  try {
    res = await fetch(`https://www.googleapis.com/youtube/v3/${path}?${query}`, { signal: AbortSignal.timeout(20000) });
  } catch (err) {
    // Without the URL, which holds the key.
    throw new Error(`Couldn't reach YouTube (${err.cause?.code ?? err.name}).`);
  }
  const json = await res.json();
  if (!res.ok) throw new Error(`YouTube ${path}: ${json.error?.message ?? res.status}`);
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(cachePath, JSON.stringify({ fetchedAt: Date.now(), json }));
  return json;
}

// "PT1H2M3S" → 3723.
export function seconds(isoDuration = "") {
  const [, h = 0, m = 0, s = 0] = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/) ?? [];
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
}

// A channel (by @handle) and its latest `count` uploads, newest first, with views,
// length and publish date. Null if the handle doesn't exist.
export async function channelUploads(handle, count) {
  const channels = await youtube("channels", { part: "snippet,contentDetails,statistics", forHandle: `@${handle.replace(/^@/, "")}` });
  const channel = channels.items?.[0];
  if (!channel) return null;

  const ids = [];
  let pageToken;
  do {
    const page = await youtube("playlistItems", {
      part: "contentDetails",
      playlistId: channel.contentDetails.relatedPlaylists.uploads,
      maxResults: "50",
      ...(pageToken && { pageToken }),
    });
    ids.push(...page.items.map((item) => item.contentDetails.videoId));
    pageToken = page.nextPageToken;
  } while (pageToken && ids.length < count);

  const videos = [];
  for (let i = 0; i < Math.min(ids.length, count); i += 50) {
    const batch = await youtube("videos", { part: "snippet,statistics,contentDetails,liveStreamingDetails", id: ids.slice(i, i + 50).join(",") });
    for (const v of batch.items) {
      videos.push({
        id: v.id,
        url: `https://youtu.be/${v.id}`,
        title: v.snippet.title,
        description: v.snippet.description,
        published: v.snippet.publishedAt,
        seconds: seconds(v.contentDetails.duration),
        views: Number(v.statistics.viewCount ?? 0),
        live: Boolean(v.liveStreamingDetails),
      });
    }
  }
  return {
    handle: handle.replace(/^@/, ""),
    title: channel.snippet.title,
    subscribers: Number(channel.statistics.subscriberCount ?? 0),
    videos,
  };
}
