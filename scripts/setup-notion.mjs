// Creates the Videos tracker (Setup Guide Part 9) under your "Video Pipeline" page,
// adds the first 10 ideas, and saves NOTION_DATABASE_ID / NOTION_DATA_SOURCE_ID to .env.
//
// Before running: put NOTION_TOKEN and NOTION_PARENT_PAGE_ID (the page link is fine)
// in .env, and connect the n8n integration to that page (••• → Connections → n8n).
import { loadEnv, setEnvValue } from "./env.mjs";

const NOTION_VERSION = "2026-03-11";

const STATUSES = [
  ["Idea", "gray"],
  ["Go", "blue"],
  ["Script Ready", "yellow"],
  ["Approved", "purple"],
  ["Rendering", "orange"],
  ["Review", "red"],
  ["Scheduled", "pink"],
  ["Published", "green"],
];
const SUB_FORMATS = ["Local impact", "Small things", "What happens when", "Industry secrets", "Under the hood"];
const IDEAS = [
  "What Happens to a Town When Walmart Leaves",
  "How a Single Amazon Warehouse Reshapes a City",
  "Why Every Highway Exit Has the Same 4 Restaurants",
  "The Economics of a Single Vending Machine",
  "Why Movie Theater Popcorn Costs $9",
  "What Happens When a Small Town Hospital Closes",
  "Why Dollar General Opens Stores 5 Miles Apart",
  "The Secret World of Shipping Containers",
  "What Actually Happens When You Tap Your Card",
  "What Happens to a City When Its Mall Dies",
];

const env = loadEnv();

if (!env.NOTION_TOKEN || !env.NOTION_PARENT_PAGE_ID) {
  console.error("Fill in NOTION_TOKEN and NOTION_PARENT_PAGE_ID in .env first.");
  process.exit(1);
}
if (env.NOTION_DATABASE_ID && !process.argv.includes("--force")) {
  console.error("NOTION_DATABASE_ID is already set, so the table exists. Use --force to create another one.");
  process.exit(1);
}

// Accepts a page link (https://www.notion.so/Video-Pipeline-<32 hex>?pvs=4) or a bare ID.
const parentId = env.NOTION_PARENT_PAGE_ID.split(/[?#]/)[0].replace(/-/g, "").match(/[0-9a-f]{32}$/i)?.[0];
if (!parentId) {
  console.error("Couldn't find a page ID in NOTION_PARENT_PAGE_ID. Paste the page's Share → Copy link URL.");
  process.exit(1);
}

async function notion(method, path, body) {
  const res = await fetch(`https://api.notion.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.NOTION_TOKEN}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: body && JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) {
    const hint = {
      unauthorized: "NOTION_TOKEN is wrong.",
      object_not_found: "The page isn't shared with the integration: on the page, ••• → Connections → n8n.",
    }[json.code];
    throw new Error(`${json.code}: ${json.message}${hint ? `\n${hint}` : ""}`);
  }
  return json;
}

try {
  const db = await notion("POST", "databases", {
    parent: { type: "page_id", page_id: parentId },
    title: [{ type: "text", text: { content: "Videos" } }],
    initial_data_source: {
      properties: {
        Title: { type: "title", title: {} },
        Status: { type: "select", select: { options: STATUSES.map(([name, color]) => ({ name, color })) } },
        "Sub-format": { type: "select", select: { options: SUB_FORMATS.map((name) => ({ name })) } },
        Brief: { type: "rich_text", rich_text: {} },
        Script: { type: "rich_text", rich_text: {} },
        Sources: { type: "rich_text", rich_text: {} },
        "Publish date": { type: "date", date: {} },
        Notes: { type: "rich_text", rich_text: {} },
      },
    },
  });
  const dataSourceId = db.data_sources?.[0]?.id;
  if (!dataSourceId) throw new Error("Notion created the table but returned no data source ID.");

  // Save right away so a re-run doesn't create a duplicate table.
  setEnvValue("NOTION_DATABASE_ID", db.id.replace(/-/g, ""));
  setEnvValue("NOTION_DATA_SOURCE_ID", dataSourceId);
  console.log(`Created "Videos" table: ${db.url}`);

  for (const idea of IDEAS) {
    await notion("POST", "pages", {
      parent: { type: "data_source_id", data_source_id: dataSourceId },
      properties: {
        Title: { title: [{ text: { content: idea } }] },
        Status: { select: { name: "Idea" } },
      },
    });
    console.log(`  + ${idea}`);
  }
  console.log("\nDone. IDs saved to .env. Run `npm run check` to confirm.");
} catch (err) {
  console.error(`\nNotion error: ${err.message}`);
  process.exit(1);
}
