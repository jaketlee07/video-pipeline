// Before scenes are planned, tidies the lines Jake changed or added in the approved
// script so the narrator reads them cleanly, and writes them back to Notion so the
// page shows exactly what will be said.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { ask, prompt } from "./claude.mjs";
import { editMarkdown } from "./notion.mjs";
import { parseScript } from "./script.mjs";

const Cleaned = z.object({ lines: z.array(z.object({ id: z.number().int(), text: z.string() })) });

// Escapes text so Notion stores it as plain words rather than formatting.
const escapeMarkdown = (text) => text.replace(/([\\`*_[\]<>])/g, "\\$1").replace(/^([#>+-]|\d+\.)/, "\\$1");

// Takes the script's paragraphs ({ part, text, raw }) and returns them with Jake's
// edits cleaned up.
export async function cleanEdits(video, dir, paragraphs) {
  const draftPath = join(dir, "script-draft.md");
  const cleanedPath = join(dir, "cleaned-lines.json");
  if (!existsSync(draftPath)) {
    console.log("No script draft on file to compare against, so your edits weren't cleaned up.");
    return paragraphs;
  }

  // Lines matching Claude's draft, or cleaned on an earlier run, are left alone.
  const cleanedBefore = existsSync(cleanedPath) ? JSON.parse(readFileSync(cleanedPath, "utf8")) : [];
  const known = new Set([...parseScript(readFileSync(draftPath, "utf8")).map((p) => p.text), ...cleanedBefore]);
  const edited = paragraphs.flatMap((p, index) => (known.has(p.text) ? [] : [{ ...p, index }]));
  if (!edited.length) {
    console.log("No edits of yours to clean up.");
    return paragraphs;
  }

  console.log(`Cleaning up ${edited.length} line(s) you changed or added...`);
  const edits = edited
    .map((p, n) =>
      [
        `<edit id="${n + 1}">`,
        `<before>${paragraphs[p.index - 1]?.text ?? "(start of script)"}</before>`,
        `<line>${p.text}</line>`,
        `<after>${paragraphs[p.index + 1]?.text ?? "(end of script)"}</after>`,
        "</edit>",
      ].join("\n"),
    )
    .join("\n\n");
  const reply = await ask({
    label: "cleanup",
    effort: "medium",
    maxTokens: 16000,
    system: prompt("channel"),
    user: prompt("cleanup", { title: video.title, edits }),
    format: betaZodOutputFormat(Cleaned),
  });
  const cleaned = new Map(Cleaned.parse(JSON.parse(reply)).lines.map((l) => [l.id, l.text.replace(/\s+/g, " ").trim()]));

  const result = [...paragraphs];
  const changes = [];
  edited.forEach((p, n) => {
    const text = cleaned.get(n + 1);
    if (!text || text === p.text) return;
    result[p.index] = { part: p.part, text, raw: escapeMarkdown(text) };
    changes.push({ before: p.text, after: text, raw: p.raw });
  });

  let warnings = [];
  if (changes.length) {
    warnings = await editMarkdown(video.id, changes.map((c) => ({ from: c.raw, to: escapeMarkdown(c.after) })));
  }
  writeFileSync(cleanedPath, `${JSON.stringify([...cleanedBefore, ...edited.map((p) => result[p.index].text)], null, 2)}\n`);

  const unchanged = edited.length - changes.length;
  console.log(
    changes.length
      ? `Cleaned ${changes.length} line(s) and updated them on your Notion page${unchanged ? ` (${unchanged} already fine)` : ""}:`
      : `All ${edited.length} of your edited line(s) were already fine.`,
  );
  for (const { before, after } of changes) console.log(`  before: ${before}\n  after:  ${after}\n`);
  for (const w of warnings) console.log(`  Couldn't update the page: ${w.message}`);
  return result;
}
