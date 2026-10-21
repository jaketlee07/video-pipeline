// The Notion "Videos" table is the pipeline's control panel: each row is a video,
// its Status says which stage runs next, and its page body holds the brief and script.
import { loadEnv } from "./env.mjs";

const NOTION_VERSION = "2026-03-11";
const env = loadEnv();

export async function notion(method, path, body) {
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
  if (!res.ok) throw new Error(`Notion ${method} ${path.split("?")[0]}: ${json.code}: ${json.message}`);
  return json;
}

const plain = (richText = []) => richText.map((t) => t.plain_text).join("");

export function slugify(text) {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_-]+/g, "-")
    .slice(0, 80);
}

// The fields the pipeline uses from a Videos row.
function readVideo(page) {
  const props = page.properties;
  const title = plain(props.Title?.title);
  return {
    id: page.id,
    url: page.url,
    title,
    slug: slugify(title),
    status: props.Status?.select?.name ?? null,
    subFormat: props["Sub-format"]?.select?.name ?? null,
  };
}

// Finds the row to work on: by page link or ID, by words in its title, or, with
// no argument, the only row whose Status is `status`.
export async function findVideo(arg, status) {
  const id = arg?.split(/[?#]/)[0].replace(/-/g, "").match(/[0-9a-f]{32}$/i)?.[0];
  if (id) return readVideo(await notion("GET", `pages/${id}`));

  const filter = arg
    ? { property: "Title", title: { contains: arg } }
    : { property: "Status", select: { equals: status } };
  const { results } = await notion("POST", `data_sources/${env.NOTION_DATA_SOURCE_ID}/query`, { filter, page_size: 10 });
  if (results.length === 1) return readVideo(results[0]);

  const where = arg ? `with "${arg}" in the title` : `with Status "${status}"`;
  if (!results.length) throw new Error(`No video ${where}.`);
  const titles = results.map((r) => `  - ${readVideo(r).title}`).join("\n");
  throw new Error(`${results.length} videos ${where}:\n${titles}\nName one, e.g. npm run <stage> -- "walmart"`);
}

export async function getMarkdown(pageId) {
  return (await notion("GET", `pages/${pageId}/markdown`)).markdown;
}

// Replaces the whole page body.
export async function setMarkdown(pageId, markdown) {
  await notion("PATCH", `pages/${pageId}/markdown`, {
    type: "replace_content",
    replace_content: { new_str: markdown },
  });
}

// Replaces exact snippets of the page body ({ from, to } pairs, as markdown).
// Returns Notion's warnings, e.g. for a snippet it couldn't find.
export async function editMarkdown(pageId, edits) {
  const res = await notion("PATCH", `pages/${pageId}/markdown`, {
    type: "update_content",
    update_content: { content_updates: edits.map(({ from, to }) => ({ old_str: from, new_str: to })) },
  });
  return res.warnings ?? [];
}

// Sets Status and/or text properties, e.g. { status: "Script Ready", text: { Brief: "..." } }.
export async function updateVideo(pageId, { status, text = {} }) {
  const properties = {};
  if (status) properties.Status = { select: { name: status } };
  for (const [name, value] of Object.entries(text)) {
    // Text properties take at most 100 pieces of 2,000 characters.
    const chunks = (value.match(/[\s\S]{1,2000}/g) ?? []).slice(0, 100);
    properties[name] = { rich_text: chunks.map((content) => ({ type: "text", text: { content } })) };
  }
  await notion("PATCH", `pages/${pageId}`, { properties });
}

// Returns the raw markdown under a "## <name>" heading, up to the next "## " heading.
export function pageSection(markdown, name) {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => line.trim().toLowerCase() === `## ${name.toLowerCase()}`);
  if (start === -1) return null;
  const end = lines.findIndex((line, i) => i > start && /^##\s/.test(line.trim()));
  return lines.slice(start + 1, end === -1 ? undefined : end).join("\n").trim();
}

// Notion's markdown escapes punctuation (\$, \[, \~); this undoes it.
export const unescapeMarkdown = (text) => text.replace(/\\([\\`*_{}[\]()#+\-.!$~|<>&"'])/g, "$1");
