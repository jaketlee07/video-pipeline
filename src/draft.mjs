// Research brief + script draft for the video marked "Go" (guide stages 2 and 3).
// Writes both into the row's Notion page and moves it to "Script Ready".
//
//   npm run draft                          the row with Status "Go"
//   npm run draft -- walmart               the row with "walmart" in its title
//   npm run draft -- walmart --force       redo it even if not "Go" or the page has content
//   npm run draft -- mall --script-only    rewrite only the script, from the brief on the
//                                          page (e.g. after correcting a fact); about $0.25
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ask, extractTag, prompt, totalSpent } from "./claude.mjs";
import { findVideo, getMarkdown, pageSection, setMarkdown, unescapeMarkdown, updateVideo } from "./notion.mjs";
import { videoDir } from "./paths.mjs";
import { parseScript, wordCount, WORDS_PER_SECOND } from "./script.mjs";

const args = process.argv.slice(2);
const force = args.includes("--force");
const scriptOnly = args.includes("--script-only");
const query = args.filter((a) => !a.startsWith("--")).join(" ") || undefined;

// Keep "## Brief" and "## Script" the only level-2 headings on the page.
const demoteHeadings = (markdown) => markdown.replace(/^#{1,2}\s/gm, "### ");

const CHECKPOINT_NOTE =
  "> Checkpoint 1: fact-check the numbers in the brief's Fact-check list and read the script through, editing anything you like, including the question for viewers and the pinned comment at the end. Then set Status to Approved.";

// --script-only replaces the Script section, so refuse if it was edited after drafting.
function assertScriptUnedited(dir, markdown) {
  const draftPath = join(dir, "script-draft.md");
  const spokenText = (md) => JSON.stringify(parseScript(md).map((p) => [p.part, p.text]));
  const onPage = spokenText(pageSection(markdown, "Script") ?? "");
  if (!existsSync(draftPath) || onPage !== spokenText(readFileSync(draftPath, "utf8"))) {
    throw new Error("The script on the Notion page was edited after it was drafted, and --script-only would replace it. Add --force to replace it anyway.");
  }
}

async function main() {
  const video = await findVideo(query, scriptOnly ? "Script Ready" : "Go");
  const dir = videoDir(video.slug);
  const markdown = await getMarkdown(video.id);
  const vars = { title: video.title, subFormat: video.subFormat ?? "not set; pick the best fit" };
  const system = prompt("channel");
  let brief;

  if (scriptOnly) {
    if (!["Go", "Script Ready"].includes(video.status) && !force) {
      throw new Error(`"${video.title}" is "${video.status}". --script-only works on Go or Script Ready rows; add --force to override.`);
    }
    brief = pageSection(markdown, "Brief");
    if (!brief) throw new Error(`"${video.title}" has no "## Brief" section to write from. Run npm run draft first.`);
    brief = unescapeMarkdown(brief);
    if (!force) assertScriptUnedited(dir, markdown);
    console.log(`Rewriting the script for "${video.title}" from the brief on its page...`);
  } else {
    if (video.status !== "Go" && !force) {
      throw new Error(`"${video.title}" is "${video.status}", not "Go". Set it to Go in Notion, or add --force.`);
    }
    // Notion marks the empty line a fresh page gets as <empty-block/>.
    if (markdown.replace(/<empty-block\/>/g, "").trim() && !force) {
      throw new Error(`"${video.title}" already has content on its Notion page. Clear it, or add --force to replace it.`);
    }
    console.log(`Drafting "${video.title}"\n\n1/2 Researching the brief (web search, a few minutes)...`);
    const research = await ask({
      label: "brief",
      system,
      user: prompt("brief", vars),
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 15 }],
    });
    brief = demoteHeadings(extractTag(research, "brief"));
    writeFileSync(join(dir, "brief.md"), `${brief}\n`);
    console.log("\n2/2 Writing the script...");
  }

  const reply = await ask({ label: "script", system, user: prompt("script", { ...vars, brief }) });
  const script = demoteHeadings(extractTag(reply, "script"));
  const pinned = reply.includes("</pinned_comment>") ? extractTag(reply, "pinned_comment") : "";
  writeFileSync(join(dir, "script-draft.md"), `${script}\n`);
  await setMarkdown(
    video.id,
    ["## Brief", brief, "## Script", CHECKPOINT_NOTE, script, ...(pinned ? ["## Pinned comment", pinned] : [])].join("\n\n"),
  );

  const paragraphs = parseScript(script);
  const words = paragraphs.reduce((sum, p) => sum + wordCount(p.text), 0);
  const minutes = words / WORDS_PER_SECOND / 60;
  const viewerQuestion = paragraphs.find((p) => /\bcomments\b/i.test(p.text));
  const sources = [...new Set(brief.match(/https?:\/\/[^\s)\]>"]+/g) ?? [])];
  const angle = brief.match(/\*\*Angle:\*\*\s*(.+)/)?.[1].trim() ?? "";

  await updateVideo(video.id, {
    status: "Script Ready",
    text: {
      Brief: angle,
      Sources: sources.join("\n"),
      Script: `Draft: ${words.toLocaleString("en-US")} words, about ${minutes.toFixed(1)} min. Edit it on this page.`,
    },
  });

  console.log(`
Done: "${video.title}" is now Script Ready.
  Script: ${words.toLocaleString("en-US")} words, about ${minutes.toFixed(1)} minutes
  Question for viewers: ${viewerQuestion ? viewerQuestion.text : "none found; add one on the page if you want it"}
  Pinned comment: ${pinned ? "at the end of the page" : "none written; add one on the page if you want it"}
  Sources: ${sources.length}
  Claude cost: about $${totalSpent().toFixed(2)}
  Open it: ${video.url}`);
}

main().catch((err) => {
  console.error(`\n${err.message}`);
  process.exit(1);
});
