// Scene list from the approved script (guide stage 4): which visual goes with
// each stretch of narration. Writes media/<slug>/scenes.json and narration.txt.
//
//   npm run scenes                     the row with Status "Approved"
//   npm run scenes -- walmart          the row with "walmart" in its title
//   npm run scenes -- walmart --force  even if its Status isn't "Approved"
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { MODEL, ask, prompt, totalSpent } from "./claude.mjs";
import { cleanEdits } from "./cleanup.mjs";
import { findVideo, getMarkdown, pageSection, unescapeMarkdown } from "./notion.mjs";
import { videoDir } from "./paths.mjs";
import { WORDS_PER_SECOND, bracketNotes, fitToSentences, parseScript, splitSentences } from "./script.mjs";

const args = process.argv.slice(2);
const force = args.includes("--force");
const query = args.filter((a) => a !== "--force").join(" ") || undefined;

const Scene = z.object({
  first: z.number().int().describe("Number of the first sentence in this scene"),
  last: z.number().int().describe("Number of the last sentence in this scene"),
  type: z.enum(["stock", "chart", "number", "map", "aerial", "title", "image"]),
  visual: z.string().describe("What's on screen, in one sentence"),
  search: z.array(z.string()).describe("Two or three Pixabay video queries for fallback b-roll"),
  text: z.string().nullable().describe("On-screen words for number and title scenes, otherwise null"),
  place: z.string().nullable().describe("For map and aerial scenes, the real place (e.g. 'Kimball, West Virginia'), otherwise null"),
  chart: z
    .object({
      kind: z.enum(["bar", "line"]),
      title: z.string(),
      unit: z.string(),
      points: z.array(z.object({ label: z.string(), value: z.number() })),
      source: z.string(),
    })
    .nullable()
    .describe("For chart scenes only, otherwise null"),
});
const Plan = z.object({ scenes: z.array(Scene) });

async function main() {
  const video = await findVideo(query, "Approved");
  if (video.status !== "Approved" && !force) {
    throw new Error(`"${video.title}" is "${video.status}", not "Approved". Approve the script in Notion first, or add --force.`);
  }

  const markdown = await getMarkdown(video.id);
  const scriptMarkdown = pageSection(markdown, "Script");
  if (!scriptMarkdown) throw new Error(`"${video.title}" has no "## Script" section on its Notion page.`);
  const notes = bracketNotes(parseScript(scriptMarkdown));
  if (notes.length) {
    const list = notes.map((n) => `  - ${n.text}`).join("\n");
    throw new Error(`The script has [bracketed] notes the narrator would read aloud. Remove them first:\n${list}`);
  }
  const dir = videoDir(video.slug);
  const paragraphs = await cleanEdits(video, dir, parseScript(scriptMarkdown));
  const sentences = splitSentences(paragraphs);
  if (!sentences.length) throw new Error("The Script section has no narration.");

  const listing = [];
  for (const s of sentences) {
    if (s.part !== sentences[s.id - 2]?.part) listing.push(`\n[${s.part}]`);
    listing.push(`${s.id} (${s.words} words) ${s.text}`);
  }
  const totalWords = sentences.reduce((sum, s) => sum + s.words, 0);
  console.log(`Planning scenes for "${video.title}" (${sentences.length} sentences, about ${(totalWords / WORDS_PER_SECOND / 60).toFixed(1)} min)...`);

  const reply = await ask({
    label: "scenes",
    system: prompt("channel"),
    user: prompt("scenes", {
      title: video.title,
      count: String(sentences.length),
      brief: unescapeMarkdown(pageSection(markdown, "Brief") ?? "(no brief on the page)"),
      sentences: listing.join("\n").trim(),
    }),
    format: betaZodOutputFormat(Plan),
  });
  const { scenes, repaired } = fitToSentences(Plan.parse(JSON.parse(reply)).scenes, sentences.length);

  const planned = scenes.map((scene, i) => {
    const lines = sentences.slice(scene.first - 1, scene.last);
    const words = lines.reduce((sum, s) => sum + s.words, 0);
    const { first, last, ...visual } = scene;
    return {
      id: i + 1,
      sentences: [first, last],
      part: lines[0].part,
      narration: lines.map((s) => s.text).join(" "),
      estSeconds: Math.round((words / WORDS_PER_SECOND) * 10) / 10,
      ...visual,
    };
  });

  writeFileSync(join(dir, "narration.txt"), `${paragraphs.map((p) => p.text).join("\n\n")}\n`);
  writeFileSync(
    join(dir, "scenes.json"),
    `${JSON.stringify(
      {
        title: video.title,
        slug: video.slug,
        notionUrl: video.url,
        plannedAt: new Date().toISOString(),
        model: MODEL,
        sentences: sentences.map(({ id, part, text }) => ({ id, part, text })),
        scenes: planned,
      },
      null,
      2,
    )}\n`,
  );

  // Share of screen time by scene type.
  const totalSeconds = planned.reduce((sum, s) => sum + s.estSeconds, 0);
  const share = (types) =>
    Math.round((100 * planned.filter((s) => types.includes(s.type)).reduce((sum, s) => sum + s.estSeconds, 0)) / totalSeconds);
  const long = planned.filter((s) => s.estSeconds > 15);

  console.log(`
Done: ${planned.length} scenes, about ${(totalSeconds / planned.length).toFixed(1)} seconds each.
  Screen time: graphics ${share(["chart", "number", "map", "title"])}%, stock ${share(["stock"])}%, aerial ${share(["aerial"])}%, real imagery ${share(["image"])}%
  Charts: ${planned.filter((s) => s.type === "chart").length}, maps and aerials: ${planned.filter((s) => s.type === "map" || s.type === "aerial").length}${
    long.length ? `\n  Longer than 15 seconds: scenes ${long.map((s) => s.id).join(", ")}` : ""
  }${repaired ? `\n  Fixed ${repaired} scene boundaries so every sentence is covered once.` : ""}
  Claude cost: about $${totalSpent().toFixed(2)}
  Saved: media/${video.slug}/scenes.json and narration.txt`);
}

main().catch((err) => {
  console.error(`\n${err.message}`);
  process.exit(1);
});
