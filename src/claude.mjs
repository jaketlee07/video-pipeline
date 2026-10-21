import { readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { loadEnv } from "./env.mjs";

export const MODEL = "claude-opus-5-5";

const env = loadEnv();
const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

// Prompts live in src/prompts/*.md so the channel's voice can be tuned without
// touching code. {{name}} placeholders are filled from `vars`.
export function prompt(name, vars = {}) {
  const text = readFileSync(new URL(`./prompts/${name}.md`, import.meta.url), "utf8");
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (!(key in vars)) throw new Error(`prompts/${name}.md uses {{${key}}}, which wasn't provided`);
    return vars[key];
  });
}

// Opus 5.5 list prices (USD), for a rough cost line after each call.
const PRICE = { input: 4e-6, cacheWrite: 5e-6, cacheRead: 0.2e-6, output: 20e-6, search: 0.01 };
let spent = 0;
export const totalSpent = () => spent;

function logUsage(label, usage) {
  const searches = usage.server_tool_use?.web_search_requests ?? 0;
  const cost =
    usage.input_tokens * PRICE.input +
    (usage.cache_creation_input_tokens ?? 0) * PRICE.cacheWrite +
    (usage.cache_read_input_tokens ?? 0) * PRICE.cacheRead +
    usage.output_tokens * PRICE.output +
    searches * PRICE.search;
  spent += cost;
  const n = (x) => x.toLocaleString("en-US");
  const cached = (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
  console.log(
    `   ${label}: ${n(usage.input_tokens)} tokens in${cached ? ` (+${n(cached)} cached)` : ""}, ${n(usage.output_tokens)} out` +
      `${searches ? `, ${searches} searches` : ""}, about $${cost.toFixed(2)}`,
  );
}

/**
 * One streamed Claude turn. Resumes `pause_turn` (long web-search turns) and
 * returns all the text Claude wrote. Server-side fallback is on, so a safety
 * decline is retried on Anthropic's recommended fallback model.
 */
export async function ask({ label, system, user, tools, format, effort = "high", maxTokens = 64000 }) {
  const messages = [{ role: "user", content: user }];
  let text = "";
  for (let resumes = 0; ; resumes++) {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: maxTokens,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system,
      messages,
      // With caching on, web search caches each batch of results, so the many
      // re-reads during a research turn bill at the cache-read rate.
      ...(tools && { tools, cache_control: { type: "ephemeral" } }),
      output_config: { effort, ...(format && { format }) },
    });
    stream.on("contentBlock", (block) => {
      if (block.type === "server_tool_use" && block.name === "web_search") console.log(`     search: ${block.input?.query}`);
    });
    const message = await stream.finalMessage();
    logUsage(label, message.usage);
    text += message.content.filter((b) => b.type === "text").map((b) => b.text).join("");

    if (message.stop_reason === "pause_turn" && resumes < 5) {
      messages.push({ role: "assistant", content: message.content });
      continue;
    }
    if (message.stop_reason === "refusal") {
      const { category, explanation } = message.stop_details ?? {};
      throw new Error(`${label}: Claude declined (${category ?? "no category"}). ${explanation ?? ""}`);
    }
    if (message.stop_reason === "max_tokens") throw new Error(`${label}: ran out of output tokens before finishing.`);
    if (message.stop_reason === "pause_turn") throw new Error(`${label}: still researching after 5 resumes; run it again.`);
    return text;
  }
}

// Returns what Claude wrote between the last <tag> and </tag>.
export function extractTag(text, tag) {
  const end = text.lastIndexOf(`</${tag}>`);
  const start = text.lastIndexOf(`<${tag}>`, end);
  if (end === -1 || start === -1) throw new Error(`Claude's reply had no <${tag}> section.`);
  return text.slice(start + tag.length + 2, end).trim();
}
