// Final check (Setup Guide Part 12). Tests each key in .env with one cheap,
// read-only request per service, then checks n8n and git. Never prints a key.
import { execFileSync } from "node:child_process";
import { loadEnv } from "../src/env.mjs";

const NOTION_VERSION = "2026-03-11";
const env = loadEnv();

// Thrown by checks for optional services that aren't set up; not counted as a failure.
class Skipped extends Error {}

function need(...keys) {
  const missing = keys.filter((key) => !env[key]);
  if (missing.length) throw new Error(`fill in ${missing.join(", ")} in .env`);
}

async function request(url, { method = "GET", headers = {}, body } = {}) {
  let res;
  try {
    res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(15000) });
  } catch (err) {
    // Rethrow without the URL, which can contain a key (Pixabay).
    throw new Error(`network error (${err.cause?.code ?? err.name})`);
  }
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {}
  return { res, json, text };
}

const notionHeaders = () => ({
  Authorization: `Bearer ${env.NOTION_TOKEN}`,
  "Notion-Version": NOTION_VERSION,
  "Content-Type": "application/json",
});

const checks = {
  async Pexels() {
    // Optional: Pexels paused new API keys (Oct 2026). Pixabay covers stock on its own.
    if (!env.PEXELS_API_KEY) throw new Skipped("optional, skipped (Pexels has paused new API keys)");
    const { res, json } = await request("https://api.pexels.com/videos/search?query=highway&per_page=1", {
      headers: { Authorization: env.PEXELS_API_KEY },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: key copied wrong?`);
    return `key works (${json.total_results} highway clips)`;
  },

  async Pixabay() {
    need("PIXABAY_API_KEY");
    const key = encodeURIComponent(env.PIXABAY_API_KEY);
    const { res, json } = await request(`https://pixabay.com/api/videos/?key=${key}&q=highway&per_page=3`);
    if (!res.ok) throw new Error(`HTTP ${res.status}: key copied wrong?`);
    return `key works (${json.totalHits} highway clips)`;
  },

  async Coverr() {
    // Optional: more stock video. The free plan allows 50 requests an hour.
    if (!env.COVERR_API_KEY) throw new Skipped("optional, skipped (a free key at coverr.co → Profile → API adds more stock video)");
    const { res, json } = await request("https://api.coverr.co/videos?query=highway&page_size=1", { headers: { "x-api-key": env.COVERR_API_KEY } });
    if (!res.ok) throw new Error(`HTTP ${res.status}: key copied wrong?`);
    return `key works (${json.total} highway clips)`;
  },

  async YouTube() {
    // Optional: public video stats and comments. Free; 10,000 quota units a day.
    if (!env.YOUTUBE_API_KEY) throw new Skipped("optional, skipped (a free YouTube Data API v3 key reads public video stats)");
    const key = encodeURIComponent(env.YOUTUBE_API_KEY);
    const { res, json } = await request(`https://www.googleapis.com/youtube/v3/videos?part=statistics&id=7OGH3LJJbaU&key=${key}`);
    if (!res.ok) {
      const reason = json?.error?.errors?.[0]?.reason ?? json?.error?.details?.[0]?.reason;
      if (/accessNotConfigured|SERVICE_DISABLED/.test(reason)) throw new Error("key works, but YouTube Data API v3 isn't enabled in its project");
      if (/API_KEY|keyInvalid|badRequest/i.test(reason ?? "") || res.status === 400) throw new Error(`HTTP ${res.status}: key copied wrong?`);
      throw new Error(`HTTP ${res.status}: ${reason ?? "request refused"}`);
    }
    const views = json.items?.[0]?.statistics?.viewCount;
    return views ? `key works (the Walmart video has ${Number(views).toLocaleString("en-US")} views)` : "key works";
  },

  async ElevenLabs() {
    need("ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID");
    const voiceId = encodeURIComponent(env.ELEVENLABS_VOICE_ID);
    const { res, json } = await request(`https://api.elevenlabs.io/v1/voices/${voiceId}`, {
      headers: { "xi-api-key": env.ELEVENLABS_API_KEY },
    });
    if (res.status === 401) throw new Error("key rejected: copied wrong, or missing the Voices (read) permission");
    if (!res.ok) throw new Error(`HTTP ${res.status}: voice ID wrong? ${json?.detail?.message ?? ""}`.trim());
    return `key works, narrator voice is "${json.name}"`;
  },

  async Claude() {
    need("ANTHROPIC_API_KEY");
    const { res } = await request("https://api.anthropic.com/v1/models?limit=1", {
      headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: key copied wrong?`);
    return "key works (credit balance isn't checked; see console.anthropic.com)";
  },

  async Notion() {
    need("NOTION_TOKEN");
    if (!env.NOTION_DATABASE_ID) {
      const { res } = await request("https://api.notion.com/v1/users/me", { headers: notionHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}: token copied wrong?`);
      throw new Error("token works; now run `npm run notion:setup` to create the Videos table");
    }
    const db = await request(`https://api.notion.com/v1/databases/${encodeURIComponent(env.NOTION_DATABASE_ID)}`, {
      headers: notionHeaders(),
    });
    if (!db.res.ok) throw new Error(`HTTP ${db.res.status}: ${db.json?.message ?? "database not found"}`);
    const dataSourceId = env.NOTION_DATA_SOURCE_ID || db.json.data_sources?.[0]?.id;
    const rows = await request(`https://api.notion.com/v1/data_sources/${dataSourceId}/query`, {
      method: "POST",
      headers: notionHeaders(),
      body: JSON.stringify({ page_size: 100 }),
    });
    if (!rows.res.ok) throw new Error(`HTTP ${rows.res.status}: ${rows.json?.message ?? "couldn't read rows"}`);
    const title = db.json.title?.map((t) => t.plain_text).join("") || "Untitled";
    return `"${title}" table has ${rows.json.results.length} rows`;
  },

  async n8n() {
    const { res } = await request("http://localhost:5678/healthz").catch(() => {
      throw new Error("not running: open Docker Desktop, then `npm run n8n:up`");
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from localhost:5678`);
    return "running at http://localhost:5678";
  },

  async Git() {
    try {
      execFileSync("git", ["check-ignore", "-q", ".env"], { stdio: "ignore" });
    } catch {
      throw new Error(".env is NOT ignored by git; add `.env` to .gitignore before committing anything");
    }
    return ".env is ignored";
  },
};

const results = await Promise.all(
  Object.entries(checks).map(async ([name, check]) => {
    try {
      return { name, ok: true, message: await check() };
    } catch (err) {
      return { name, ok: false, skipped: err instanceof Skipped, message: err.message };
    }
  }),
);

for (const { name, ok, skipped, message } of results) {
  console.log(`${ok ? "✓" : skipped ? "–" : "✗"} ${name.padEnd(11)} ${message}`);
}
const required = results.filter((r) => !r.skipped);
const failed = required.filter((r) => !r.ok).length;
console.log(failed ? `\n${failed} of ${required.length} not ready yet.` : "\nEverything checks out. Setup done.");
process.exitCode = failed ? 1 : 0;
