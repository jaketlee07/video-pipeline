// Research brief + script draft for the video marked "Go" (guide stages 2 and 3).
// Writes both into the row's Notion page and moves it to "Script Ready".
//
//   npm run draft                          the row with Status "Go"
//   npm run draft -- walmart               the row with "walmart" in its title
//   npm run draft -- walmart --force       redo it even if not "Go" or the page has content
//   npm run draft -- "its mall" --script-only
//                                          write a new script from the brief on the page
//                                          (e.g. after correcting a fact); about $0.50
//   npm run draft -- walmart --from-file=edited.md
//                                          put a script edited outside Notion on the page
//                                          as a new draft (no Claude; keeps the brief and
//                                          the pinned comment)
//
// A new script never throws the old one away: the script on the page, with your
// edits and its pinned comment, moves to an "Earlier script, draft N" section at
// the bottom of the page. Only the section called "Script" is narrated.
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ask, extractTag, prompt, totalSpent } from "./claude.mjs";
import { findVideo, getMarkdown, pageSections, setMarkdown, unescapeMarkdown, updateVideo } from "./notion.mjs";
import { videoDir } from "./paths.mjs";
import { parseScript, wordCount, WORDS_PER_SECOND } from "./script.mjs";

const args = process.argv.slice(2);
const force = args.includes("--force");
const fromFile = args.find((a) => a.startsWith("--from-file="))?.slice("--from-file=".length);
const scriptOnly = args.includes("--script-only") || Boolean(fromFile);
const query = args.filter((a) => !a.startsWith("--")).join(" ") || undefined;

// Keep "## " headings for the page's own sections (Brief, Script, ...).
const demoteHeadings = (markdown) => markdown.replace(/^#{1,2}\s/gm, "### ");

const EARLIER = /^Earlier script, draft (\d+)$/i;
// Notes the pipeline writes, dropped when a script moves to an earlier draft.
const OWN_NOTE = /^>\s*(Checkpoint 1:|Not narrated:)/;

const checkpointNote = (draft, hasEarlier) =>
  "> Checkpoint 1: fact-check the numbers in the brief's Fact-check list and read the script through, editing anything you like, including the question for viewers and the pinned comment at the end. Then set Status to Approved." +
  (hasEarlier ? ` This is draft ${draft}; the earlier drafts are kept at the bottom of the page.` : "");

const quoted = (markdown) =>
  markdown
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => `> ${line.trim()}`)
    .join("\n");

// The page's current script as an earlier draft: kept word for word, edits and all.
function earlierSection(number, script, pinned, writtenOn) {
  const body = script
    .split("\n")
    .filter((line) => !OWN_NOTE.test(line.trim()))
    .join("\n")
    .trim();
  const note =
    `> Not narrated: only the section called Script is. This draft was written ${writtenOn}. ` +
    `To narrate it instead, rename this heading to "Script" and the current Script heading to "Earlier script, draft ${number + 1}".`;
  return [`## Earlier script, draft ${number}`, note, body, ...(pinned ? ["> Its pinned comment:", quoted(pinned)] : [])].join("\n\n");
}

// Moves the last draft file aside (script-draft-1.md, -2, ...) so the cleanup step
// still recognizes its lines as Claude's if you go back to that draft.
function keepDraftFile(dir) {
  const current = join(dir, "script-draft.md");
  if (!existsSync(current)) return;
  let n = 1;
  while (existsSync(join(dir, `script-draft-${n}.md`))) n++;
  renameSync(current, join(dir, `script-draft-${n}.md`));
}

const longDate = (date) => date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

async function main() {
  const video = await findVideo(query, scriptOnly ? "Script Ready" : "Go");
  const dir = videoDir(video.slug);
  const markdown = await getMarkdown(video.id);
  const sections = pageSections(markdown);
  const section = (name) => sections.find((s) => s.name?.toLowerCase() === name)?.body ?? "";
  const vars = { title: video.title, subFormat: video.subFormat ?? "not set; pick the best fit", notes: video.notes?.trim() || "none" };
  const system = prompt("channel");
  let brief;
  let briefOnPage;

  if (scriptOnly) {
    if (!["Go", "Script Ready"].includes(video.status) && !force) {
      throw new Error(`"${video.title}" is "${video.status}". --script-only works on Go or Script Ready rows; add --force to override.`);
    }
    briefOnPage = section("brief");
    if (!briefOnPage) throw new Error(`"${video.title}" has no "## Brief" section to write from. Run npm run draft first.`);
    brief = unescapeMarkdown(briefOnPage);
    console.log(fromFile ? `Putting ${fromFile} on "${video.title}"'s page as a new draft...` : `Writing a new script for "${video.title}" from the brief on its page...`);
  } else {
    if (video.status !== "Go" && !force) {
      throw new Error(`"${video.title}" is "${video.status}", not "Go". Set it to Go in Notion, or add --force.`);
    }
    // Notion marks the empty line a fresh page gets as <empty-block/>.
    if (markdown.replace(/<empty-block\/>/g, "").trim() && !force) {
      throw new Error(
        `"${video.title}" already has content on its Notion page. Add --force to redo the brief and script (the current script is kept on the page as an earlier draft), or use --script-only to keep the brief.`,
      );
    }
    console.log(`Drafting "${video.title}"\n\n1/2 Researching the brief (web search, a few minutes)...`);
    const research = await ask({
      label: "brief",
      system,
      user: prompt("brief", vars),
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 20 }],
    });
    brief = briefOnPage = demoteHeadings(extractTag(research, "brief"));
    writeFileSync(join(dir, "brief.md"), `${brief}\n`);
    console.log("\n2/2 Writing the script...");
  }

  let script;
  let pinned;
  if (fromFile) {
    script = demoteHeadings(readFileSync(fromFile, "utf8").trim());
    pinned = section("pinned comment");
  } else {
    const reply = await ask({ label: "script", system, user: prompt("script", { ...vars, brief }) });
    script = demoteHeadings(extractTag(reply, "script"));
    pinned = reply.includes("</pinned_comment>") ? extractTag(reply, "pinned_comment") : "";
  }

  // The script already on the page becomes an earlier draft.
  const oldScript = section("script");
  const keepOld = parseScript(oldScript).length > 0;
  const lastEarlier = Math.max(0, ...sections.map((s) => Number(s.name?.match(EARLIER)?.[1] ?? 0)));
  const archived = keepOld ? lastEarlier + 1 : null;
  const draftNumber = (archived ?? lastEarlier) + 1;
  const draftPath = join(dir, "script-draft.md");
  const writtenOn = existsSync(draftPath) ? `on ${longDate(statSync(draftPath).mtime)}` : "before this one";
  keepDraftFile(dir);
  writeFileSync(draftPath, `${script}\n`);

  // Any other sections on the page (earlier drafts, your own notes) stay as they are.
  const ours = new Set(["brief", "script", "pinned comment"]);
  const others = sections.filter((s) => s.name !== null && !ours.has(s.name.toLowerCase())).map((s) => `## ${s.name}\n\n${s.body}`);
  const preamble = sections.find((s) => s.name === null)?.body;
  await setMarkdown(
    video.id,
    [
      ...(preamble ? [preamble] : []),
      "## Brief",
      briefOnPage,
      "## Script",
      checkpointNote(draftNumber, draftNumber > 1),
      script,
      ...(pinned ? ["## Pinned comment", pinned] : []),
      ...others,
      ...(keepOld ? [earlierSection(archived, oldScript, section("pinned comment"), writtenOn)] : []),
    ].join("\n\n"),
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
      Script: `Draft ${draftNumber}: ${words.toLocaleString("en-US")} words, about ${minutes.toFixed(1)} min. Edit it on this page${draftNumber > 1 ? "; earlier drafts are at the bottom" : ""}.`,
    },
  });

  console.log(`
Done: "${video.title}" is now Script Ready.
  Script: draft ${draftNumber}, ${words.toLocaleString("en-US")} words, about ${minutes.toFixed(1)} minutes
  Question for viewers: ${viewerQuestion ? viewerQuestion.text : "none found; add one on the page if you want it"}
  Pinned comment: ${pinned ? "after the script" : "none written; add one on the page if you want it"}
  Earlier script: ${keepOld ? `kept at the bottom of the page as "Earlier script, draft ${archived}", edits and all` : "none"}
  Sources: ${sources.length}
  Claude cost: about $${totalSpent().toFixed(2)}
  Open it: ${video.url}`);
}

main().catch((err) => {
  console.error(`\n${err.message}`);
  process.exit(1);
});
