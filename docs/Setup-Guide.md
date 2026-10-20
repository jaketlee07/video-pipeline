# Setup Guide: Build the Automation Before the Channel

Oct 19, 2026 · for Jake

Do these in order, one box at a time. Each box is a single action. When a box says **You should see**, check that before moving on.

Use your **personal** laptop and **personal** email for everything here. The channel Gmail and YouTube account come later.

Where a step differs by computer, it's marked **Mac:** or **Windows:**. Do only the one that matches yours.

| Part | What you set up | Time |
| --- | --- | --- |
| 1 | Ground rules and a password manager | 15 min |
| 2 | Terminal and install tools | 45 min |
| 3 | GitHub and your private repo | 20 min |
| 4 | Your `.env` secrets file | 10 min |
| 5 | Pexels API key | 10 min |
| 6 | Pixabay API key | 5 min |
| 7 | ElevenLabs voice and API key | 30 min |
| 8 | Claude API key | 10 min |
| 9 | Notion video tracker | 30 min |
| 10 | Docker and n8n | 40 min |
| 11 | Remotion test video | 20 min |
| 12 | Final check | 5 min |

Total: about 4 hours. Cost: $0 (plus a few dollars of prepaid Claude API credit in Part 8).

**The one rule for keys:** an API key is a password for a program. Every time you create one, paste it into your password manager immediately (most sites only show it once). Never paste a key into a chat, email, screenshot, or this project.

---

## Part 1. Ground rules (15 min)

- [ ] 1. Decide which personal computer you'll use for this. Never use a work laptop, work email or work GitHub for any of it.
- [ ] 2. Go to [bitwarden.com](https://bitwarden.com) and create a free account (skip if you already use 1Password or Apple Passwords).
- [ ] 3. Install the Bitwarden browser extension.
- [ ] 4. In Bitwarden, create a folder called **Video Pipeline**. Every login and key from this guide goes in there.

**You should see:** a Video Pipeline folder in your password manager.

---

## Part 2. Terminal and tools (45 min)

### Open a terminal

- [ ] 1. **Mac:** press Cmd+Space, type `Terminal`, press Enter.
      **Windows:** press Start, type `PowerShell`, press Enter.

**You should see:** a window with a blinking cursor. This is where you paste commands. Paste one command, press Enter, wait for it to finish, then do the next.

### Mac only: install Homebrew

- [ ] 2. Go to [brew.sh](https://brew.sh) and click the copy button next to the install command.
- [ ] 3. Paste it into Terminal and press Enter.
- [ ] 4. Type your Mac password when asked (nothing shows as you type; that's normal) and press Enter.
- [ ] 5. Press Enter again if it says "Press RETURN to continue".
- [ ] 6. Wait for "Installation successful".
- [ ] 7. Under **Next steps**, it shows two or three commands. Copy and run each one.
- [ ] 8. Run:
      ```bash
      brew --version
      ```

**You should see:** `Homebrew 4.x` or higher.

### Install Git

- [ ] 9. Run:
      **Mac:** `brew install git`
      **Windows:** `winget install --id Git.Git -e`
      (Windows: type `Y` and press Enter if asked to agree to terms.)

### Install Node.js

- [ ] 10. Run:
      **Mac:** `brew install node@24`
      **Windows:** `winget install OpenJS.NodeJS.LTS`
- [ ] 11. **Mac only:** if the output says "node@24 is keg-only", copy the `echo 'export PATH=...'` line it prints and run it, then run `source ~/.zshrc`.

### Install FFmpeg

- [ ] 12. Run:
      **Mac:** `brew install ffmpeg`
      **Windows:** `winget install Gyan.FFmpeg`

### Install VS Code (the code editor)

- [ ] 13. Run:
      **Mac:** `brew install --cask visual-studio-code`
      **Windows:** `winget install Microsoft.VisualStudioCode`

### Check everything

- [ ] 14. Close the terminal window and open a new one (so it picks up the new tools).
- [ ] 15. Run each of these, one at a time:
      ```bash
      git --version
      node -v
      npm -v
      ffmpeg -version
      ```

**You should see:** a version number for each: `git version 2.x`, `v24.x` (or `v26.x`), `10.x` or `11.x`, and `ffmpeg version 7.x` or higher. If any says "not found", redo that tool's install step and open a new terminal.

### Tell Git who you are

- [ ] 16. Run (with your real name):
      ```bash
      git config --global user.name "Jake YourLastName"
      ```
- [ ] 17. Run (with your personal email, the same one you'll use for GitHub):
      ```bash
      git config --global user.email "you@example.com"
      ```

### Check disk space

- [ ] 18. **Mac:** Apple menu → About This Mac → More Info → Storage.
      **Windows:** Settings → System → Storage.
- [ ] 19. Confirm at least **30 to 50 GB free**. Stock clips and renders take space. Clear some if needed.

---

## Part 3. GitHub and your private repo (20 min)

### Create the account

- [ ] 1. Go to [github.com/signup](https://github.com/signup). (Already have a personal, non-work account? Sign in and skip to step 5.)
- [ ] 2. Enter your personal email, a password, and a username.
- [ ] 3. Enter the code GitHub emails you.
- [ ] 4. Save the login in your password manager.

### Turn on two-factor login

- [ ] 5. Click your profile picture (top right) → **Settings**.
- [ ] 6. Left menu → **Password and authentication**.
- [ ] 7. Click **Enable two-factor authentication**.
- [ ] 8. Choose **Authenticator app** (not SMS) and scan the QR code with Google Authenticator, Authy, or your password manager.
- [ ] 9. Enter the 6-digit code.
- [ ] 10. Click **Download** on the recovery codes and save them in your password manager.

### Create the repo

- [ ] 11. Click **+** (top right) → **New repository**.
- [ ] 12. Repository name: `video-pipeline`.
- [ ] 13. Select **Private**.
- [ ] 14. Tick **Add a README file**.
- [ ] 15. Under **Add .gitignore**, choose **Node**.
- [ ] 16. Click **Create repository**.

**You should see:** a page titled `your-username/video-pipeline` with a **Private** label.

### Connect it to this project

- [ ] 17. In this project, open **Project settings → Resources** (or the [Project settings](#project-settings/resources) link).
- [ ] 18. Add the `video-pipeline` repository.
- [ ] 19. If it asks to connect GitHub or install the Claude app, follow the prompts and choose **Only select repositories → video-pipeline**.

**You should see:** `video-pipeline` listed in the project's resources.

### Download it to your computer

- [ ] 20. In the terminal, go to your home folder:
      ```bash
      cd ~
      ```
- [ ] 21. Copy the repo (replace `YOUR-USERNAME`):
      ```bash
      git clone https://github.com/YOUR-USERNAME/video-pipeline.git
      ```
- [ ] 22. If a browser window opens asking you to sign in to GitHub, sign in and click **Authorize**.
- [ ] 23. Open the folder in VS Code:
      ```bash
      code video-pipeline
      ```
      (If `code` isn't found: open VS Code, then File → Open Folder → choose `video-pipeline` in your home folder.)

**You should see:** VS Code open with `README.md` and `.gitignore` in the left sidebar.

---

## Part 4. Your `.env` secrets file (10 min)

This one file holds all your keys on your computer. It must never go to GitHub.

- [ ] 1. In VS Code, click the **New File** icon in the left sidebar (next to the folder name).
- [ ] 2. Name it exactly `.env` (with the dot, no other extension) and press Enter.
- [ ] 3. Paste this into it:
      ```bash
      PEXELS_API_KEY=
      PIXABAY_API_KEY=
      ELEVENLABS_API_KEY=
      ELEVENLABS_VOICE_ID=
      ANTHROPIC_API_KEY=
      NOTION_TOKEN=
      NOTION_DATABASE_ID=
      ```
- [ ] 4. Save (Cmd+S on Mac, Ctrl+S on Windows).
- [ ] 5. Click `.gitignore` in the sidebar and press Cmd+F / Ctrl+F. Search for `.env`.
- [ ] 6. If `.env` isn't in the file, add a new line at the top that says `.env` and save.
- [ ] 7. In the terminal, run:
      ```bash
      cd ~/video-pipeline
      git status
      ```

**You should see:** `.env` is **not** listed. (Its name should also look greyed out in VS Code.) If it is listed, redo step 6 before going further.

From now on, each time you get a key: paste it after the `=` on the matching line (no spaces, no quotes), save, and also save it in your password manager.

---

## Part 5. Pexels API key (10 min)

> **Skip for now (Oct 20, 2026):** Pexels has paused new API keys. Pixabay (Part 6) covers stock footage on its own, and `npm run check` treats Pexels as optional. Come back to this part if Pexels reopens.

- [ ] 1. Go to [pexels.com](https://www.pexels.com) and click **Join**.
- [ ] 2. Sign up with your personal email and confirm it.
- [ ] 3. Go to [pexels.com/api](https://www.pexels.com/api/).
- [ ] 4. Click **Your API Key** (or **Get Started**).
- [ ] 5. Fill in the form. For the description, write: *"A personal tool that searches Pexels videos by keyword to assemble b-roll for my own YouTube explainer videos."*
- [ ] 6. Tick the terms box and submit.
- [ ] 7. Copy the key shown on the page.
- [ ] 8. Paste it into `.env` after `PEXELS_API_KEY=` and into your password manager.
- [ ] 9. Test it. Run this with your key in place of `YOUR_KEY` (**Windows:** type `curl.exe` instead of `curl`):
      ```bash
      curl -H "Authorization: YOUR_KEY" "https://api.pexels.com/videos/search?query=highway&per_page=1"
      ```

**You should see:** a long block of text containing `"videos"` and links. If you see `401` or "Unauthorized", the key was copied wrong.

Good to know: the free limit is 200 searches an hour, which is plenty. Pexels asks for credit, which we'll add to every video description.

---

## Part 6. Pixabay API key (5 min)

- [ ] 1. Go to [pixabay.com](https://pixabay.com) and click **Join**.
- [ ] 2. Sign up with your personal email and confirm it.
- [ ] 3. While logged in, open [pixabay.com/api/docs](https://pixabay.com/api/docs/).
- [ ] 4. Scroll to **Parameters**. Your key is shown in green next to `key`.
- [ ] 5. Copy it into `.env` after `PIXABAY_API_KEY=` and into your password manager.
- [ ] 6. Test it (**Windows:** `curl.exe`):
      ```bash
      curl "https://pixabay.com/api/videos/?key=YOUR_KEY&q=highway&per_page=3"
      ```

**You should see:** text containing `"hits"` and video links. "Invalid or missing API key" means it was copied wrong.

---

## Part 7. ElevenLabs voice and API key (30 min)

### Sign up

- [ ] 1. Go to [elevenlabs.io](https://elevenlabs.io) and click **Sign up**.
- [ ] 2. Sign up with your personal email. Choose the **Free** plan if asked.

### Pick your narrator

- [ ] 3. Open **Voices** in the left menu, then **Voice Library** (or **Explore**).
- [ ] 4. Filter: Language **English**, Use case **Narration** or **Narrative & Story**.
- [ ] 5. Click play on voices and add 4 to 6 you like to **My Voices**.
- [ ] 6. Open **Text to Speech**.
- [ ] 7. Paste this test line:
      *"When Walmart left this town, three other businesses died within a year. Here's why that happens, and why it could happen near you."*
- [ ] 8. Generate it with each of your saved voices.
- [ ] 9. Listen on headphones, then on your phone speaker.
- [ ] 10. Pick one. This will be the narrator for every video.
- [ ] 11. Open that voice's details and click the **ID** / copy icon.
- [ ] 12. Paste it into `.env` after `ELEVENLABS_VOICE_ID=`.

### Create the API key

- [ ] 13. Open **Developers** in the left menu (or click your profile → **API Keys**).
- [ ] 14. Click **Create API key** and name it `video-pipeline`.
- [ ] 15. If it shows permissions, turn on **Text to Speech** and **Voices** (read). If it offers a credit limit, set one.
- [ ] 16. Click **Create** and copy the key.
- [ ] 17. Paste it into `.env` after `ELEVENLABS_API_KEY=` and into your password manager.
- [ ] 18. Test it (**Windows:** `curl.exe`):
      ```bash
      curl -H "xi-api-key: YOUR_KEY" https://api.elevenlabs.io/v1/user
      ```

**You should see:** your account details, including character limits.

### Don't pay yet, but know this

Audio made on the **Free** plan can't be used in monetized videos and must credit ElevenLabs. Upgrade right before you generate narration you'll publish:

| Plan | Price (checked Oct 2026) | About | Fits |
| --- | --- | --- | --- |
| Free | $0 | 10 min/month | Testing only |
| Starter | ~$5 to $6/mo | 30 min/month | ~2 videos a month |
| Creator | $22/mo | ~100 min/month | 1 video a week plus re-takes |

Confirm on [elevenlabs.io/pricing](https://elevenlabs.io/pricing) when you upgrade.

---

## Part 8. Claude API key (10 min)

n8n uses this to have Claude write briefs, scripts and scene lists. It's billed separately from your claude.ai plan.

- [ ] 1. Go to [console.anthropic.com](https://console.anthropic.com) and sign in with your personal email.
- [ ] 2. Open **Billing** (or **Plans & Billing**).
- [ ] 3. Add a card.
- [ ] 4. Buy the minimum amount of credit.
- [ ] 5. Find **Limits** and set a monthly spend limit you're comfortable with (for example $10).
- [ ] 6. Open **API Keys** and click **Create Key**.
- [ ] 7. Name it `video-pipeline` and click **Create**.
- [ ] 8. Copy the key (it starts with `sk-ant-`).
- [ ] 9. Paste it into `.env` after `ANTHROPIC_API_KEY=` and into your password manager.

**You should see:** the key in the API Keys list and a credit balance above $0.

---

## Part 9. Notion video tracker (30 min)

### Create the tracker

- [ ] 1. Go to [notion.so](https://www.notion.so) and sign up with your personal email. Choose **For myself** / the free plan.
- [ ] 2. In the left sidebar, click **+ Add a page** (or **New page**).
- [ ] 3. Title it `Video Pipeline`.
- [ ] 4. In the page body, type `/database` and choose **Database – Full page** (or **Table**).
- [ ] 5. Name the database `Videos`.

### Add the columns

Click **+** at the right end of the column headers to add each one:

- [ ] 6. Rename the first column (`Name`) to `Title`.
- [ ] 7. Add `Status` as type **Select**, with options: `Idea`, `Go`, `Script Ready`, `Approved`, `Rendering`, `Review`, `Scheduled`, `Published`.
- [ ] 8. Add `Sub-format` as **Select**, with options: `Local impact`, `Small things`, `What happens when`, `Industry secrets`, `Under the hood`.
- [ ] 9. Add `Brief` as **Text**.
- [ ] 10. Add `Script` as **Text**.
- [ ] 11. Add `Sources` as **Text**.
- [ ] 12. Add `Publish date` as **Date**.
- [ ] 13. Add `Notes` as **Text**.
- [ ] 14. Delete any extra default columns (like `Tags`).

### Add your first 10 ideas

- [ ] 15. Add one row for each, with Status `Idea`:
      1. What Happens to a Town When Walmart Leaves
      2. How a Single Amazon Warehouse Reshapes a City
      3. Why Every Highway Exit Has the Same 4 Restaurants
      4. The Economics of a Single Vending Machine
      5. Why Movie Theater Popcorn Costs $9
      6. What Happens When a Small Town Hospital Closes
      7. Why Dollar General Opens Stores 5 Miles Apart
      8. The Secret World of Shipping Containers
      9. What Actually Happens When You Tap Your Card
      10. What Happens to a City When Its Mall Dies

### Let n8n access it

- [ ] 16. Go to [notion.so/profile/integrations](https://www.notion.so/profile/integrations).
- [ ] 17. Click **New integration**.
- [ ] 18. Name: `n8n`. Type: **Internal**. Workspace: yours. Click **Save**.
- [ ] 19. Click **Show** next to **Internal Integration Secret**, then copy it.
- [ ] 20. Paste it into `.env` after `NOTION_TOKEN=` and into your password manager.
- [ ] 21. Go back to your **Videos** database.
- [ ] 22. Click **•••** (top right) → **Connections** → search `n8n` → click it → **Confirm**.
- [ ] 23. Click **Share** (top right) → **Copy link**.
- [ ] 24. Paste the link somewhere temporary. The database ID is the 32 letters and numbers after the last `/` and before `?v=`.
- [ ] 25. Paste just that ID into `.env` after `NOTION_DATABASE_ID=`.

**You should see:** 10 rows in the table, and `n8n` listed under **•••** → **Connections**.

(Why not Airtable: its free plan allows only 1,000 API calls a month, and n8n would use that up in days.)

---

## Part 10. Docker and n8n (40 min)

### Install Docker Desktop

- [ ] 1. Run:
      **Mac:** `brew install --cask docker`
      **Windows:** `winget install Docker.DockerDesktop`
- [ ] 2. **Windows only:** if asked to enable **WSL 2**, click yes, then restart your computer.
- [ ] 3. Open the **Docker** app (Mac: Applications; Windows: Start menu).
- [ ] 4. Accept the terms. Choose **Personal** use if asked. Skip sign-in.
- [ ] 5. Wait until the bottom-left of the Docker window says **Engine running**.
- [ ] 6. In the terminal, run:
      ```bash
      docker run hello-world
      ```

**You should see:** "Hello from Docker!"

### Start n8n

- [ ] 7. Run:
      ```bash
      docker volume create n8n_data
      ```
- [ ] 8. Run (one long line):
      ```bash
      docker run -d --name n8n --restart unless-stopped -p 5678:5678 -v n8n_data:/home/node/.n8n docker.n8n.io/n8nio/n8n
      ```
- [ ] 9. Wait about 30 seconds, then open [http://localhost:5678](http://localhost:5678) in your browser.
- [ ] 10. Fill in the **Set up owner account** form (email, name, password).
- [ ] 11. Save that login in your password manager.
- [ ] 12. Skip or answer the short survey.

**You should see:** the n8n home screen with a **Create workflow** button.

Useful later: `docker stop n8n` stops it, `docker start n8n` starts it again. Your workflows are kept either way. Docker Desktop needs to be open for n8n to run.

*Backup option if Docker won't cooperate:* [n8n Cloud](https://n8n.io) has a 14-day free trial, then about €20/month. Tell me if you go that way, since renders then need an extra step.

---

## Part 11. Remotion test video (20 min)

- [ ] 1. In the terminal, go home:
      ```bash
      cd ~
      ```
- [ ] 2. Run:
      ```bash
      npx create-video@latest
      ```
- [ ] 3. If asked "Ok to proceed?", type `y` and press Enter.
- [ ] 4. Choose the **Hello World** template (arrow keys, then Enter).
- [ ] 5. Name the folder `remotion-test`.
- [ ] 6. Say no to any extras it offers (TailwindCSS, skills) for now.
- [ ] 7. Run:
      ```bash
      cd remotion-test
      npm install
      ```
- [ ] 8. Run:
      ```bash
      npm run dev
      ```
- [ ] 9. A browser tab opens with **Remotion Studio**. Press play on the sample.
- [ ] 10. Go back to the terminal and press Ctrl+C to stop the studio.
- [ ] 11. Run:
      ```bash
      npx remotion render
      ```
      If it asks which composition, pick the first one. The first render downloads a browser and can take a few minutes.
- [ ] 12. Open the `out` folder inside `remotion-test` and double-click the MP4.

**You should see:** a short animated video that plays.

- [ ] 13. Optional: delete the `remotion-test` folder. The real project will live in `video-pipeline`.

(Remotion is free for individuals, including monetized YouTube.)

---

## Part 12. Final check (5 min)

- [ ] 1. Run `npm run check`. Every line should show ✓ (Pexels may show – as skipped).
- [ ] 2. Run `git status` in `~/video-pipeline` once more. Confirm `.env` is not listed.
- [ ] 3. Confirm Docker Desktop is running and [localhost:5678](http://localhost:5678) opens n8n.
- [ ] 4. Confirm your Notion **Videos** table has 10 ideas and the `n8n` connection.
- [ ] 5. Confirm the repo shows up in this project's settings.
- [ ] 6. Post in the project: **"Setup done."**

Then we build the pipeline together and test it on video 1, in this order:

1. Claude prompts that write the brief, script and scene list into Notion
2. ElevenLabs narration with timing
3. Stock clip fetching from Pexels and Pixabay
4. Remotion scenes (stock clips, charts, maps, big numbers, captions, Shorts layout)
5. n8n wiring between them, with your two checkpoints (approve the script, review the render)

### Not now (comes later)

- Channel name, channel Gmail, YouTube Brand Account, TikTok and Instagram handles
- Paying for ElevenLabs (right before your first published narration)
- Google Earth Studio for aerials ([earth.google.com/studio](https://earth.google.com/studio), Chrome only)
- Canva for thumbnails

---

*Prices and limits checked Oct 18, 2026: [ElevenLabs (Costbench)](https://www.costbench.com/software/ai-voice-tools/elevenlabs/), [ElevenLabs commercial rights (BigVU)](https://bigvu.tv/blog/elevenlabs-pricing-2026-plans-credits-commercial-rights-api-costs/), [n8n pricing (Toolradar)](https://toolradar.com/blog/n8n-pricing-2026), [n8n Cloud trial](https://docs.n8n.io/deploy/use-n8n-cloud/start-your-free-trial), [Remotion license FAQ](https://www.remotion.dev/docs/license/faq), [Pexels API limits](https://help.pexels.com/hc/en-us/articles/900005852323), [Pixabay API summary](https://blog.laozhang.ai/en/posts/free-image-api.md), [Airtable free tier](https://agentdeals.dev/vendor/airtable), [Node.js releases](https://versionlog.com/nodejs/). Recheck ElevenLabs and n8n on their own sites before paying.*
