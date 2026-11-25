// Topic finder. Lists the videos from channels in our niche that did far better
// than their own channel's usual, ranked by that multiple instead of raw views: a
// big channel's average video says little, but one with five times the views of
// the uploads around it says its topic or packaging hit. Public stats come from the
// YouTube Data API (YOUTUBE_API_KEY; a run uses about 150 of the 10,000 free daily
// units, and answers are cached for a day). Then Claude names what the outliers
// share and suggests Everyday Case Study ideas from them (about $0.15).
//
//   npm run ideas                  the outliers, then Claude's ideas
//   npm run ideas -- --list        just the outliers, no Claude
//   npm run ideas -- --add=1,3     add ideas 1 and 3 from the last run to Notion as
//                                  Idea rows (--add for all of them), with the
//                                  outliers each came from in its Notes, which the
//                                  research step reads. No new searches or Claude.
//
// Each run is saved to media/ideas/<date>.md (and .json, for --add). Edit CHANNELS
// to change who's compared.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { ask, prompt, totalSpent } from "./claude.mjs";
import { loadEnv } from "./env.mjs";
import { notion } from "./notion.mjs";
import { channelUploads, hasYouTubeKey } from "./youtube.mjs";

// Independent explainer channels in our niche (business, cities, tech, news), by @handle.
const CHANNELS = [
  "ModernMBA", "Micro-Econ-YT", "Wendoverproductions", "HowMoneyWorks", "EconomicsExplained",
  "halfasinteresting", "PolyMatter", "LogicallyAnswered", "MagnatesMedia", "BusinessCasual",
  "TLDRBusiness", "EconomyMedia", "WallStreetMillennial", "RetailArchaeology", "CityBeautiful",
  "CityNerd", "Asianometry", "ColdFusion",
];
const UPLOADS = 150; // latest uploads read per channel
const MIN_SECONDS = 181; // Shorts run up to 3 minutes
const MIN_AGE_DAYS = 21; // younger videos are still gathering views
const MAX_AGE_DAYS = 3 * 365;
const NEIGHBOURS = 8; // uploads on each side a video is compared with
const MIN_NEIGHBOURS = 6;
const MIN_MULTIPLE = 2;
const PER_CHANNEL = 4; // so one channel can't fill the list
const SHOW = 30;
const IDEAS = 8;

const args = process.argv.slice(2);
const listOnly = args.includes("--list");
const addArg = args.find((a) => a === "--add" || a.startsWith("--add="));
const env = loadEnv();
const DAY_MS = 24 * 60 * 60 * 1000;
const OUT_DIR = fileURLToPath(new URL("../media/ideas/", import.meta.url));

const compact = (n) => new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
function ago(iso) {
  const days = (Date.now() - Date.parse(iso)) / DAY_MS;
  return days < 75 ? `${Math.round(days / 7)} weeks ago` : days < 600 ? `${Math.round(days / 30)} months ago` : `${(days / 365).toFixed(1)} years ago`;
}

// Every video's views over the median of the channel's neighbouring uploads.
async function outliers() {
  const found = [];
  for (const handle of CHANNELS) {
    const channel = await channelUploads(handle, UPLOADS);
    if (!channel) {
      console.log(`  @${handle}: not found, skipped`);
      continue;
    }
    const age = (v) => (Date.now() - Date.parse(v.published)) / DAY_MS;
    const videos = channel.videos
      .filter((v) => !v.live && v.seconds >= MIN_SECONDS && age(v) >= MIN_AGE_DAYS && age(v) <= MAX_AGE_DAYS)
      .sort((a, b) => a.published.localeCompare(b.published));
    let count = 0;
    for (const [i, video] of videos.entries()) {
      const near = [...videos.slice(Math.max(0, i - NEIGHBOURS), i), ...videos.slice(i + 1, i + 1 + NEIGHBOURS)];
      const usual = near.length >= MIN_NEIGHBOURS ? median(near.map((n) => n.views)) : 0;
      if (!usual) continue;
      found.push({ ...video, channel: channel.title, subscribers: channel.subscribers, usual, multiple: video.views / usual });
      count++;
    }
    console.log(`  ${channel.title}: ${count} long videos compared`);
  }
  const perChannel = {};
  return found
    .filter((v) => v.multiple >= MIN_MULTIPLE)
    .sort((a, b) => b.multiple - a.multiple)
    .filter((v) => (perChannel[v.channel] = (perChannel[v.channel] ?? 0) + 1) <= PER_CHANNEL)
    .slice(0, SHOW);
}

const line = (v, i) =>
  `${i + 1}. ${v.multiple.toFixed(1)}× its channel's usual: ${compact(v.views)} views (usual ${compact(v.usual)}), ${v.channel}, ${ago(v.published)}, ${Math.round(v.seconds / 60)} min\n   "${v.title}"\n   ${v.url}`;

// Titles of every row in the Notion table, so ideas don't repeat one.
async function existingRows() {
  const rows = [];
  let cursor;
  do {
    const page = await notion("POST", `data_sources/${env.NOTION_DATA_SOURCE_ID}/query`, { page_size: 100, ...(cursor && { start_cursor: cursor }) });
    for (const r of page.results) rows.push({ title: r.properties.Title.title.map((t) => t.plain_text).join(""), status: r.properties.Status.select?.name ?? "" });
    cursor = page.has_more ? page.next_cursor : undefined;
  } while (cursor);
  return rows;
}

async function suggest(list, rows) {
  const ds = await notion("GET", `data_sources/${env.NOTION_DATA_SOURCE_ID}`);
  const subFormats = ds.properties["Sub-format"].select.options.map((o) => o.name);
  const Ideas = z.object({
    pattern: z.string(),
    ideas: z.array(z.object({ title: z.string(), subFormat: z.enum(subFormats), from: z.array(z.number().int()), why: z.string() })),
  });
  const forClaude = list.map((v, i) => `${line(v, i)}\n   Description: ${v.description.replace(/\s+/g, " ").slice(0, 240)}`).join("\n\n");
  const reply = await ask({
    label: "ideas",
    effort: "medium",
    maxTokens: 16000,
    system: prompt("channel"),
    user: prompt("ideas", { outliers: forClaude, existing: rows.map((r) => `- ${r.title} (${r.status})`).join("\n"), count: String(IDEAS) }),
    format: betaZodOutputFormat(Ideas),
  });
  return Ideas.parse(JSON.parse(reply));
}

// Adds ideas from the last saved run to Notion, all of them or the numbers given.
async function addFromLastRun() {
  const runs = existsSync(OUT_DIR) ? readdirSync(OUT_DIR).filter((f) => f.endsWith(".json")) : [];
  if (!runs.length) throw new Error("No saved ideas yet. Run npm run ideas first.");
  const last = runs.map((f) => `${OUT_DIR}${f}`).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  const { date, list, ideas } = JSON.parse(readFileSync(last, "utf8"));
  const numbers = addArg.includes("=") ? addArg.split("=")[1].split(",").map(Number) : ideas.map((_, i) => i + 1);
  const bad = numbers.filter((n) => !ideas[n - 1]);
  if (bad.length) throw new Error(`The last run (${last.split("/").pop()}) has ideas 1 to ${ideas.length}; there's no ${bad.join(", ")}.`);
  const rows = await existingRows();
  const taken = new Set(rows.map((r) => r.title.toLowerCase()));
  console.log(`Adding from ${last.split("/").pop()} to Notion as Idea rows:`);
  for (const idea of numbers.map((n) => ideas[n - 1])) {
    if (taken.has(idea.title.toLowerCase())) {
      console.log(`  = ${idea.title} (already in the table)`);
      continue;
    }
    const from = idea.from.map((n) => list[n - 1]).filter(Boolean);
    const notes = [`From npm run ideas, ${date}: ${idea.why}`, "Inspired by:", ...from.map((v) => `- "${v.title}" (${v.channel}, ${v.multiple.toFixed(1)}× its usual) ${v.url}`)].join("\n");
    await notion("POST", "pages", {
      parent: { type: "data_source_id", data_source_id: env.NOTION_DATA_SOURCE_ID },
      properties: {
        Title: { title: [{ text: { content: idea.title } }] },
        Status: { select: { name: "Idea" } },
        "Sub-format": { select: { name: idea.subFormat } },
        Notes: { rich_text: [{ text: { content: notes.slice(0, 2000) } }] },
      },
    });
    console.log(`  + ${idea.title}`);
  }
}

try {
  if (addArg) {
    await addFromLastRun();
    process.exit(0);
  }
  if (!hasYouTubeKey()) throw new Error("No YOUTUBE_API_KEY in .env. See .env.example for where to get a free one.");
  console.log(`Reading the latest ${UPLOADS} uploads of ${CHANNELS.length} channels...`);
  const list = await outliers();
  if (!list.length) throw new Error(`No video beat its channel's usual by ${MIN_MULTIPLE}× or more.`);

  const today = new Date().toISOString().slice(0, 10);
  let text = `# Outliers, ${today}\n\nVideos that got at least ${MIN_MULTIPLE}× the median views of the ${NEIGHBOURS * 2} uploads around them on their own channel (long videos from the last ${MAX_AGE_DAYS / 365} years, at most ${PER_CHANNEL} a channel).\n\n${list.map(line).join("\n\n")}\n`;
  console.log(`\n${text.split("\n").slice(4).join("\n")}`);

  let pattern, ideas;
  if (!listOnly) {
    ({ pattern, ideas } = await suggest(list, await existingRows()));
    const ideasText = ideas.map((idea, i) => `${i + 1}. ${idea.title} (${idea.subFormat})\n   From ${idea.from.join(", ")}: ${idea.why}`).join("\n\n");
    text += `\n## What they share\n\n${pattern}\n\n## Ideas\n\n${ideasText}\n`;
    console.log(`What they share: ${pattern}\n\nIdeas:\n\n${ideasText}\n`);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  let name = today;
  for (let n = 2; existsSync(`${OUT_DIR}${name}.md`); n++) name = `${today}-${n}`;
  writeFileSync(`${OUT_DIR}${name}.md`, text);
  if (ideas) writeFileSync(`${OUT_DIR}${name}.json`, JSON.stringify({ date: today, pattern, ideas, list }, null, 2));
  console.log(`\nSaved to media/ideas/${name}.md.${listOnly ? "" : ` Claude cost: about $${totalSpent().toFixed(2)}. To put ideas in Notion: npm run ideas -- --add=1,3 (or --add for all).`}`);
} catch (err) {
  console.error(`\n${err.message}`);
  process.exit(1);
}
