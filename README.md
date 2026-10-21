# video-pipeline

Automation for a faceless YouTube channel on the hidden economics of everyday things.
Plan: [docs/YouTube-Automation-Guide-Book.md](docs/YouTube-Automation-Guide-Book.md).
Setup checklist: [docs/Setup-Guide.md](docs/Setup-Guide.md).

## Commands

| Command | What it does |
| --- | --- |
| `npm run draft` | For the row set to **Go**: Claude researches a sourced brief and writes the script into its Notion page, then sets it to **Script Ready**. |
| `npm run scenes` | For the row set to **Approved**: turns the script into `media/<video>/scenes.json` (one visual per 8–12 s) plus `narration.txt`. Refuses if `[bracketed notes]` are left in the narration. |
| `npm run check` | Tests every key in `.env` and checks n8n and git. Never prints keys. |
| `npm run notion:setup` | Creates the Notion **Videos** table with the first 10 ideas and saves its IDs to `.env`. |
| `npm run n8n:up` / `n8n:down` | Starts or stops n8n at http://localhost:5678 (Docker Desktop must be open). |
| `npm run n8n:logs` | Follows n8n's logs. |

Run `npm install` once after cloning (Node 22+).

## How a video moves

1. Set a row's Status to **Go** in Notion → `npm run draft`.
2. On the row's page, fact-check the brief's key numbers, read the script, edit anything → set **Approved** (checkpoint 1). The 💬 notes mark optional spots for your own take: type a line under one, or ignore it. Notes (`>` lines) are never read aloud.
   - Fixed a fact in the brief? `npm run draft -- "<title words>" --script-only` rewrites just the script from it (about $0.30).
3. `npm run scenes`. It first tidies any lines you changed or added (typos, shorthand, symbols) and updates them on the Notion page, printing a before/after for each, then plans the scenes.

Claude's prompts are in `src/prompts/` — edit `channel.md` to change the channel's voice and standards.

## Layout

- `.env`: your keys (gitignored). Template: `.env.example`.
- `src/`: the pipeline stages and their prompts.
- `media/`: voiceovers, stock clips and renders. Gitignored, and mounted into n8n at `/files`.
- `scripts/`: setup helpers.
- `docs/`: the plan and the setup guide.
