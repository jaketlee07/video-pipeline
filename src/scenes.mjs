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
import { APPROVED, findVideo, getMarkdown, pageSection, unescapeMarkdown } from "./notion.mjs";
import { videoDir } from "./paths.mjs";
import { WORDS_PER_SECOND, bracketNotes, fitToSentences, parseScript, splitSentences } from "./script.mjs";

const args = process.argv.slice(2);
const force = args.includes("--force");
const query = args.filter((a) => a !== "--force").join(" ") || undefined;

const Scene = z.object({
  first: z.number().int().describe("Number of the first sentence in this scene"),
  last: z.number().int().describe("Number of the last sentence in this scene"),
  type: z.enum(["stock", "flow", "document", "website", "chart", "number", "map", "aerial", "title", "image"]),
  visual: z.string().describe("What's on screen, in one sentence"),
  search: z.array(z.string()).describe("Two or three Pixabay video queries for fallback b-roll"),
  text: z.string().nullable().describe("On-screen words for number and title scenes, otherwise null"),
  place: z.string().nullable().describe("For map and aerial scenes, the real place (e.g. 'Kimball, West Virginia'), otherwise null"),
  chart: z
    .object({
      kind: z.enum(["bar", "line"]),
      headline: z.string().describe("One or two words naming what the data shows, like 'BURNOUT'"),
      title: z.string().describe("What's plotted, plainly"),
      unit: z.string(),
      points: z.array(z.object({ label: z.string(), value: z.number() })),
      source: z.string(),
    })
    .nullable()
    .describe("For chart scenes only, otherwise null"),
  flow: z
    .object({
      title: z.string().describe("A short heading for the diagram, like 'Where the sales tax goes'"),
      parties: z
        .array(
          z.object({
            id: z.string().describe("A short key, like 'city'"),
            label: z.string().describe("Its name on screen, at most about 22 characters, like 'Fairfield City Hall'"),
            icon: z.enum(["person", "household", "store", "government", "bank", "company", "investor", "factory", "building", "truck"]),
            note: z.string().nullable().describe("A short detail under the name, like 'pop. 11,000', or null"),
          }),
        )
        .describe("Two to five parties, in the order they should sit left to right"),
      moves: z
        .array(
          z.object({
            from: z.string().describe("A party id"),
            to: z.string().describe("A party id"),
            kind: z.enum(["money", "goods", "people", "blocked"]).describe("blocked: a flow that stops or is barred"),
            label: z.string().describe("What moves, in two to four words, like 'sales tax'"),
            amount: z.string().nullable().describe("Like '$105K a month', only when the brief gives it, otherwise null"),
          }),
        )
        .describe("One to six moves, in the order the narration mentions them"),
    })
    .nullable()
    .describe("For flow scenes only, otherwise null"),
  document: z
    .object({
      kind: z.enum(["news", "court", "filing", "statement", "study", "law", "deed", "letter"]),
      source: z.string().describe("Who published it, like 'WBRC' or 'U.S. Bankruptcy Court, N.D. Alabama'"),
      date: z.string().describe("As precise as the brief gives it, like 'January 15, 2016' or '2018'"),
      heading: z
        .string()
        .describe("The source's own title exactly as the brief's Sources list gives it; only for a record with no title there (a docket, deed or law), what it is in plain words, like 'Chapter 9 petition, City of Fairfield'"),
      quote: z.string().nullable().describe("Exact words the brief shows in quotation marks from this source, or null"),
      highlight: z.string().nullable().describe("A few words copied exactly from the quote to highlight, or null"),
      speaker: z.string().nullable().describe("Who said or wrote the quote, with their role, or null"),
      url: z.string().nullable().describe("The source's link from the brief, or null"),
    })
    .nullable()
    .describe("For document scenes only, otherwise null"),
  change: z
    .object({
      before: z.number().int().describe("The last year before the change: the year before work started, or before it closed or emptied"),
      after: z.number().int().nullable().describe("A year after the change, or null for the latest photos"),
    })
    .nullable()
    .describe("For aerial scenes about what got built, torn down or emptied at the site, otherwise null"),
  website: z
    .object({
      url: z.string().describe("The page: a company's homepage like 'https://www.amazon.com/', or a link from the brief's Sources"),
      date: z.string().nullable().describe("YYYY-MM-DD to show the page as it looked that day, for a story in the past; null for how it looks today"),
      highlight: z.string().nullable().describe("A few words that appear on that page to circle, or null"),
    })
    .nullable()
    .describe("For website scenes only, otherwise null"),
});
const Plan = z.object({ scenes: z.array(Scene) });

const MAX_PLAN_CALLS = 4;

// What a follow-up call is told about the scenes already planned, so the mix and
// the map limits hold across the whole video.
function earlierScenes(plan, from) {
  const lines = plan.map((s, i) => `${i + 1}. sentences ${s.first}–${s.last}: ${s.type}${s.place ? ` (${s.place})` : ""}`);
  return `Sentences 1 to ${from - 1} are already planned, as these scenes:\n${lines.join("\n")}\n\nPlan only the sentences below, starting at sentence ${from}, continuing on from those scenes: keep the mix across the whole video, don't repeat the last scene's type, and count the maps above toward each place's limit.\n\n`;
}

// Quotes shown on screen must appear word for word in the brief. Drops any that
// don't (the document keeps its heading) and returns those scenes' numbers.
const comparable = (text) =>
  text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[—–]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
function checkQuotes(scenes, brief) {
  const source = comparable(brief);
  const dropped = [];
  for (const [i, scene] of scenes.entries()) {
    const doc = scene.document;
    if (!doc?.quote) continue;
    const quote = comparable(doc.quote).replace(/^["']|["']$/g, "").replace(/^\.{3}|\.{3}$|…/g, "").trim();
    if (!source.includes(quote)) {
      Object.assign(doc, { quote: null, highlight: null, speaker: null });
      dropped.push(i + 1);
    } else if (doc.highlight && !comparable(doc.quote).includes(comparable(doc.highlight))) {
      doc.highlight = null;
    }
  }
  return dropped;
}

// A document card looks like the real source, so its heading must be the source's
// real title: anyone searching for it should find it. Sets each heading to the
// title its link has in the brief's Sources list ("[Title — Publisher, Year](url)")
// and returns the scenes whose heading changed.
const linkKey = (url) => url.toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/[/#?]+$/, "");
function useSourceTitles(scenes, brief) {
  const sources = brief.split(/^###\s+Sources\s*$/im)[1]?.split(/^###\s/m)[0] ?? "";
  const titles = new Map();
  for (const [, text, url] of sources.matchAll(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g)) {
    const parts = text.split(/\s+[—–]\s+/);
    titles.set(linkKey(url), (parts.length > 1 ? parts.slice(0, -1).join(" — ") : text).trim());
  }
  const retitled = [];
  for (const [i, scene] of scenes.entries()) {
    const doc = scene.document;
    const title = doc?.url && titles.get(linkKey(doc.url));
    if (title && title !== doc.heading) {
      doc.heading = title;
      retitled.push(i + 1);
    }
  }
  return retitled;
}

async function main() {
  const video = await findVideo(query, "Approved");
  if (!APPROVED.includes(video.status) && !force) {
    throw new Error(`"${video.title}" is "${video.status}". Approve the script in Notion first, or add --force.`);
  }

  const markdown = await getMarkdown(video.id);
  const scriptMarkdown = pageSection(markdown, "Script");
  if (!scriptMarkdown) throw new Error(`"${video.title}" has no "## Script" section on its Notion page.`);
  const notes = bracketNotes(parseScript(scriptMarkdown));
  if (notes.length) {
    const list = notes.map((n) => `  - ${n.text}`).join("\n");
    throw new Error(`The script has [bracketed] notes the narrator would read aloud ([pause] only works at the start of a paragraph). Remove them first:\n${list}`);
  }
  const dir = videoDir(video.slug);
  const paragraphs = await cleanEdits(video, dir, parseScript(scriptMarkdown));
  const sentences = splitSentences(paragraphs);
  if (!sentences.length) throw new Error("The Script section has no narration.");

  // The sentences from `from` on, under their part headings.
  const listing = (from) => {
    const lines = [];
    for (const s of sentences.slice(from - 1)) {
      if (s.id === from || s.part !== sentences[s.id - 2]?.part) lines.push(`\n[${s.part}]`);
      lines.push(`${s.id} (${s.words} words) ${s.text}`);
    }
    return lines.join("\n").trim();
  };
  const totalWords = sentences.reduce((sum, s) => sum + s.words, 0);
  console.log(`Planning scenes for "${video.title}" (${sentences.length} sentences, about ${(totalWords / WORDS_PER_SECOND / 60).toFixed(1)} min)...`);

  // A long script can come back planned only part of the way (an 18-minute one
  // stopped at sentence 60 of 146). The rest is planned in further calls, each
  // shown the scenes so far, instead of stretching the last scene over it.
  const brief = unescapeMarkdown(pageSection(markdown, "Brief") ?? "(no brief on the page)");
  const plan = [];
  let from = 1;
  for (let call = 1; from <= sentences.length; call++) {
    if (call > MAX_PLAN_CALLS) {
      throw new Error(`Claude planned scenes only up to sentence ${from - 1} of ${sentences.length} in ${MAX_PLAN_CALLS} tries. Run npm run scenes again.`);
    }
    if (call > 1) console.log(`  The plan stopped at sentence ${from - 1}; planning the rest from sentence ${from}...`);
    const reply = await ask({
      label: call === 1 ? "scenes" : `scenes from ${from}`,
      system: prompt("channel"),
      user: prompt("scenes", {
        title: video.title,
        first: String(from),
        count: String(sentences.length),
        brief,
        earlier: plan.length ? earlierScenes(plan, from) : "",
        sentences: listing(from),
      }),
      format: betaZodOutputFormat(Plan),
    });
    plan.push(...Plan.parse(JSON.parse(reply)).scenes.filter((s) => s.last >= from));
    from = Math.max(from - 1, ...plan.map((s) => s.last)) + 1;
  }
  const { scenes, repaired } = fitToSentences(plan, sentences.length);
  const unquoted = checkQuotes(scenes, brief);
  const retitled = useSourceTitles(scenes, brief);

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
  const count = (type) => planned.filter((s) => s.type === type).length;
  const long = planned.filter((s) => s.estSeconds > 15);

  console.log(`
Done: ${planned.length} scenes, about ${(totalSeconds / planned.length).toFixed(1)} seconds each.
  Screen time: flows, documents and web pages ${share(["flow", "document", "website"])}%, other graphics ${share(["chart", "number", "map", "title"])}%, stock ${share(["stock"])}%, aerial ${share(["aerial"])}%, real imagery ${share(["image"])}%
  Flows: ${count("flow")}, documents: ${count("document")}, web pages: ${count("website")}, charts: ${count("chart")}, numbers: ${count("number")}, maps and aerials: ${count("map") + count("aerial")} (${planned.filter((s) => s.change).length} before and after)${
    long.length ? `\n  Longer than 15 seconds: scenes ${long.map((s) => s.id).join(", ")}` : ""
  }${repaired ? `\n  Fixed ${repaired} scene boundaries so every sentence is covered once.` : ""}${
    unquoted.length ? `\n  Dropped quotes not found word for word in the brief: scenes ${unquoted.join(", ")}` : ""
  }${retitled.length ? `\n  Document headings set to the source's real title: scenes ${retitled.join(", ")}` : ""}
  Claude cost: about $${totalSpent().toFixed(2)}
  Saved: media/${video.slug}/scenes.json and narration.txt`);
}

main().catch((err) => {
  console.error(`\n${err.message}`);
  process.exit(1);
});
