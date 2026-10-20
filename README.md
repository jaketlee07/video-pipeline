# video-pipeline

Automation for a faceless YouTube channel on the hidden economics of everyday things.
Plan: [docs/YouTube-Automation-Guide-Book.md](docs/YouTube-Automation-Guide-Book.md).
Setup checklist: [docs/Setup-Guide.md](docs/Setup-Guide.md).

## Commands

| Command | What it does |
| --- | --- |
| `npm run check` | Tests every key in `.env` and checks n8n and git. Never prints keys. |
| `npm run notion:setup` | Creates the Notion **Videos** table with the first 10 ideas and saves its IDs to `.env`. |
| `npm run n8n:up` / `n8n:down` | Starts or stops n8n at http://localhost:5678 (Docker Desktop must be open). |
| `npm run n8n:logs` | Follows n8n's logs. |

No `npm install` needed yet; the scripts use only built-in Node (22+).

## Layout

- `.env`: your keys (gitignored). Template: `.env.example`.
- `media/`: voiceovers, stock clips and renders. Gitignored, and mounted into n8n at `/files`.
- `scripts/`: setup helpers.
- `docs/`: the plan and the setup guide.
