# video-pipeline

Automation for a faceless YouTube channel on the hidden economics of everyday things.
Plan: [docs/YouTube-Automation-Guide-Book.md](docs/YouTube-Automation-Guide-Book.md).
Setup checklist: [docs/Setup-Guide.md](docs/Setup-Guide.md).

## Commands

| Command | What it does |
| --- | --- |
| `npm run draft` | For the row set to **Go**: Claude researches a sourced brief and writes the script into its Notion page, then sets it to **Script Ready**. |
| `npm run scenes` | For the row set to **Approved**: turns the script into `media/<video>/scenes.json` (one visual per 8–12 s) plus `narration.txt`. Refuses if `[bracketed notes]` are left in the narration. |
| `npm run voice` | For the **Approved** row with scenes: the narrator reads `narration.txt` (ElevenLabs, one paragraph per request) into `media/<video>/narration.wav`, plus `timing.json` with when every scene, sentence and word starts. Add `--sample` to voice just the first three paragraphs. Needs a paid ElevenLabs plan for a library voice. |
| `npm run footage` | For the **Approved** row with scenes: for each stock, image and aerial scene, gathers Pixabay videos and photos and Wikimedia Commons photos of the real places named, has Claude pick the best from a still of each, and downloads it to `media/<video>/footage/`. Scenes where nothing fits get a graphic. `footage.json` keeps the runners-up and the photo credits the description needs. |
| `npm run check` | Tests every key in `.env` and checks n8n and git. Never prints keys. |
| `npm run notion:setup` | Creates the Notion **Videos** table with the first 10 ideas and saves its IDs to `.env`. |
| `npm run n8n:up` / `n8n:down` | Starts or stops n8n at http://localhost:5678 (Docker Desktop must be open). |
| `npm run n8n:logs` | Follows n8n's logs. |

Run `npm install` once after cloning (Node 22+).

## How a video moves

1. Set a row's Status to **Go** in Notion → `npm run draft`.
2. On the row's page, fact-check the brief's key numbers, read the script, edit anything → set **Approved** (checkpoint 1). The script asks viewers one question to answer in the comments, and the **Pinned comment** section at the end holds the comment to pin under the video; edit either as you like. Notes (`>` lines) are never read aloud.
   - Fixed a fact in the brief? `npm run draft -- "<title words>" --script-only` rewrites just the script from it (about $0.30).
3. `npm run scenes`. It first tidies any lines you changed or added (typos, shorthand, symbols) and updates them on the Notion page, printing a before/after for each, then plans the scenes.
4. `npm run voice`, then listen through `narration.wav` once. ElevenLabs charges per character: the 15-minute Walmart script took about 5,800 credits on the Creator plan. Paragraphs already voiced are reused, so after fixing a line, rerun `scenes` and then `voice`, and only the changed paragraphs are paid for.

Claude's prompts are in `src/prompts/` — edit `channel.md` to change the channel's voice and standards.

## Layout

- `.env`: your keys (gitignored). Template: `.env.example`.
- `src/`: the pipeline stages and their prompts.
- `media/`: voiceovers, stock clips and renders. Gitignored, and mounted into n8n at `/files`.
- `scripts/`: setup helpers.
- `docs/`: the plan and the setup guide.
