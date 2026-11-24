# YouTube Automation Guide Book

Oct 16, 2026 · @Jake

## Overview

The plan: one YouTube channel of case studies on how the world really works, built from free stock footage and code-driven motion graphics (no AI video), run as a 90-day test at about $22 to $50 a month and roughly 4 to 6 hours a week. Alternatives considered are recorded at the end for future use.

**Why this niche.** Business and economics explainers earn roughly $6 to $15 per 1,000 views, versus about $0.33 to $3 for Made for Kids content. The proven reference is "How A Single Costco Changes Its Local Economy" by Micro: a familiar place seen through an unexpected economic lens.

**The formula.** Familiar thing + unexpected economic lens = the hidden system behind ordinary life.

**Policy reality.** YouTube's inauthentic content policy (renamed July 2025, enforced at channel level since 2026) demonetizes mass-produced, templated content, AI or not. AI as a production tool is fine. What protects the channel:

- Every video genuinely researched and distinct
- Your own editorial voice and takes in every script
- One consistent ElevenLabs narrator voice reading scripts you shaped yourself
- Human judgment on every creative decision; automation only for grunt work

**Niches ruled out and why:** baby and kids content (low RPM, Made for Kids restrictions, heavy AI scrutiny), Reddit story narration (reading content you did not create is a named violation), AI music loops (primary enforcement target).

## Niche and Positioning

**Niche:** case studies on how the world really works: one real story (a company, a town, a product, a decision, an event) broken down from the record. Business, technology, cities, history and the news. The method and the look are the constant, not the subject.

**Pitch:** how the world really works, one case at a time.

**Audience:** curious adults 20 to 45, not business specialists. Anyone who has been to a Costco, a gas station or an airport, or has seen a headline and wondered what it really means.

**Sub-formats to rotate:**

| Sub-format | What it covers | Example title |
| --- | --- | --- |
| Local impact | What one store, factory or stadium does to a town | What Happens to a Town When Walmart Leaves |
| Economics of small things | Zoom in on one ordinary object or business | The Economics of a Single Vending Machine |
| What happens when | Follow one event as it ripples outward | What Happens When a Small Town Hospital Closes |
| Industry secrets | Hidden worlds most people never think about | The Secret World of Shipping Containers |
| Under the hood (occasional) | Tech systems explained with engineering authority | What Actually Happens When You Tap Your Card |
| Rise and fall | How a company, product, place or idea took off or fell apart | How Blockbuster Went From 9,000 Stores to One |
| Big decisions | One choice by a company, city or government, and everything it set off | The Highway That Split a City in Two |
| In the news | A current event explained: who gains, who loses, what usually happens next | What Happens to a Company When Its Founder CEO Leaves |

**Channel name: Everyday Case Study** (chosen November 18, 2026). Broad enough for every sub-format above, and it says what the videos are: a case study of something ordinary. On November 18 the YouTube handle @EverydayCaseStudy, everydaycasestudy.com and everydaycasestudy.co were all free; the TikTok and Instagram handles are confirmed at signup.

**About text** (YouTube Studio, Customization, Basic info, Description):

> What happens to a town when its Walmart leaves? Why do some companies, cities and ideas take off while others fall apart?
>
> Everyday Case Study takes one real story and breaks it down until it makes sense: what happened, why it happened, who it affected, and what it shows about how the world works. Business, technology, cities, history, the news: each video is a case study built from the record, with the sources listed in every description.
>
> Comment with the story you want us to break down next.

Channel art: `npm run channel-art` renders the profile picture and banner. Thumbnails, titles and descriptions come from `npm run package`.

Earlier candidates, for the record: Spillover, Knock-On, Markup, Undercount, Tollbooth, Follow the Dollar, Why It Costs That, Who Pays For This, The Hidden Bill, The Receipt, Exit Ramp Economics, Small Town Big Money, Field Case Study (most of their YouTube handles turned out to be taken). Ruled out: Second Order, Ripple Economics.

## Account Setup

Use a dedicated Gmail for the channel, run the channel as a Brand Account, and lock security down on day one.

- [x] Pick the channel name: Everyday Case Study (YouTube handle and .com free on Nov 18, 2026)
- [ ] Create a new Gmail just for the channel
- [ ] Turn on 2-step verification with an authenticator app or security key (not SMS)
- [ ] Create the YouTube channel as a Brand Account under that Gmail
- [ ] Add your personal Gmail as an owner so you can switch in without logging out
- [ ] Sign up for a Pexels API key, ElevenLabs, Canva and socials with the channel Gmail
- [ ] Claim @EverydayCaseStudy on YouTube, and grab everydaycasestudy on TikTok and Instagram for Shorts reposts
- [ ] Link to your existing AdSense account once eligible (AdSense is per person, not per channel; only one allowed)
- [ ] Use personal devices and accounts only
- [ ] Later: custom domain email via Google Workspace once sponsors reach out
- [ ] Later: LLC and an accountant once revenue is real

**Security note:** creator channels are often hijacked through fake sponsorship emails with malware attachments. Never download files from sponsor pitches.

## Tool Stack

The core stack is free apart from ElevenLabs for narration and an optional paid stock library.

| Job | Tool | Cost (USD/mo) | Notes |
| --- | --- | --- | --- |
| Research, scripts, scene list | Claude | Existing plan | Research briefs with sources, script drafts, scene JSON with stock search keywords |
| Stock b-roll | Pexels and Pixabay (free API) | Free | Pulled automatically by keyword per scene |
| Extra stock (optional) | Storyblocks or similar | Optional, verify price | Only if free libraries run thin |
| Aerials and maps | Google Earth Studio | Free | Real flyovers of actual towns; follow attribution rules |
| Real places and brands | Press kits, Wikimedia Commons | Free | Logos, storefronts, executives |
| Assembly and motion graphics | Remotion (React) | Free for individuals | Places clips on voice timing; animates charts, maps, numbers, captions; check license if you form a company with employees |
| Narration | ElevenLabs | About $22 (verify) | Pick one voice and use it in every video; API returns word timestamps for Remotion; paid tier needed for commercial rights |
| Music | YouTube Audio Library | Free | Epidemic Sound later |
| Thumbnails | Canva | Free tier | A/B test in YouTube Studio |
| Trends and analytics | Google Trends, vidIQ, YouTube Studio | Free tiers | Track CTR and retention |
| Orchestration | Notion or Airtable, n8n | Free tiers | Control panel and pipeline glue |

AI video (Higgsfield, Grok) is not in the core stack. Add it only for a scene that stock, Earth Studio and graphics genuinely can't cover; see Alternatives Considered.

## Video Format

Each long video runs 12 to 23 minutes (about 1,800 to 3,500 words of script, depending on how much the research supports) and spins off 2 to 3 Shorts. Reference channel: Modern MBA, which covers the same territory industry by industry with an on-camera host. This channel's edge is the ground-level view: one named town or store, on a map.

**Script structure:** a story, not a list.

1. **Hook (0 to 30s):** drop into one real moment, a named place on a date, and make the surprising claim. Example: "On January 28, 2016, the Walmart in Fairfield, Alabama closed, and took a third of the city's sales tax with it."
2. **Setup (to about 1:30):** why this matters to the viewer, and the video's argument in one sentence.
3. **How the money works:** who pays whom, step by step, drawn as a flow diagram.
4. **4 to 6 chapters:** moving forward in time, each with named people or companies, a turn, and one reveal backed by a number, a case or a quoted document.
5. **Twist or takeaway:** the non-obvious conclusion.
6. **Tease:** point to the next or a related video.

**Visual mix per video:**

| Visual type | Share | Source |
| --- | --- | --- |
| Evidence and explanation: money-flow diagrams, source documents with the key line highlighted | \~20% | Remotion components, from the brief's money flows and exact quotes |
| Other graphics: charts with a one-word headline, maps, big numbers, text callouts | \~30% | Remotion components (your signature look) |
| Stock b-roll | \~20% | Pixabay via API, only for ordinary visible things, never as a metaphor |
| Aerials of real places | \~15% | Wikimedia Commons, or a map zoom |
| Real branded imagery | \~15% | Press kits, Wikimedia Commons |

**Rules of thumb:** a new visual every 8 to 12 seconds; narration at about 170 words a minute (the channels this one is modelled on run 180 to 215), with a beat before the biggest reveals and a longer gap between chapters. No burned-in captions on long videos, as none of those channels use them: upload the exact .srt instead. Burned-in, word-by-word captions without punctuation are for Shorts. Because every channel uses the same free stock, the brand lives in the graphics: one color palette, one font pair, one chart style, one map style, used in every video. Showing the actual sources on screen is also the channel's best answer to YouTube's inauthentic content policy, which judges whether a whole channel looks templated and mass-produced.

**Packaging (for the title, thumbnail and description stage):** titles are the question the video answers ("What Happens to a Town When Its Walmart Leaves?", not "The Economics of Walmart Closures"), and the thumbnail says what the video is about at a glance, then hints at the answer: a headline naming the subject across the top ("WHEN WALMART LEAVES"), a bright, real photo of the thing itself filling the frame (or two side by side, to set one side against the other), and one callout, a number tag or a receipt with the line that matters circled. Logos where they help. Descriptions retell the story in two or three short paragraphs naming the places and companies, then list the sources and photo credits. Optional: a simple illustrated mascot (static art animated in Remotion) that pops in to point at key numbers.

**Shorts:** each built around the single most surprising stat from the long video, ending with a pointer to it.

## Production and Automation Workflow

Code assembles the video; you only check the script and the final render. Two human checkpoints, no manual timeline editing, no auto-publishing.

| # | Stage | Tool | Automated | You |
| --- | --- | --- | --- | --- |
| 1 | Topic pick | Notion/Airtable, Claude, Google Trends | 20 ideas a month, competitor scan | Mark the best one "Go" |
| 2 | Research brief | Claude with web search | Data, studies, case examples with sources | Fact-check key numbers |
| 3 | Script | Claude + script template | First draft in your structure | **Checkpoint 1:** rewrite hook, add your takes, approve |
| 4 | Scene JSON | Claude | Each narration chunk mapped to a scene type (flow, document, chart, map, number, title, stock) with search keywords and data | None |
| 5 | Voiceover | ElevenLabs API | Word-level timestamps generated | Listen through once; fix mispronunciations |
| 6 | Stock fetch | Script calling Pexels/Pixabay APIs | Top 3 clips per scene downloaded | None |
| 7 | Aerials | Google Earth Studio | Reusable flyover templates | Set the location (a few minutes) |
| 8 | Render | Remotion | Clips, charts, maps, captions and music placed on voice timing; long-form and vertical Shorts rendered from the same scene JSON | None |
| 9 | Review | You | None | **Checkpoint 2:** watch once, swap bad clips in the scene JSON, re-render |
| 10 | Thumbnail and title | Canva, Claude | 10 title options, thumbnail template | Choose |
| 11 | Publish | YouTube Studio scheduler | Description template with sources | Upload, schedule, final check |

**n8n wiring:**

1. Row set to "Go" in Notion/Airtable triggers Claude: brief, script, scene JSON written back to the row.
2. You approve the script (checkpoint 1); status change triggers the stock fetch and asks for the voiceover.
3. Voice file lands in the project folder; transcription adds timestamps.
4. Remotion renders long-form plus Shorts into the folder; row moves to "Review".
5. After checkpoint 2, you upload and schedule.

**One-time build (1 to 2 weekends):** Remotion scene components (stock clip with Ken Burns motion, bar and line charts, map zoom, big number, title card, captions, intro/outro), a vertical Shorts template, the Pexels fetch script, and the n8n flow.

**Never automate:** topic choice, fact-checking, the final script, the final review, or generate-and-publish without a human watching.

## Weekly Schedule and First 10 Videos

After the one-time Remotion build, one long video a week takes about 4 to 6 hours, almost all of it research, script and voice.

| Day | Task | Time |
| --- | --- | --- |
| Mon | Pick topic; fact-check the research brief | 1.5 hr |
| Tue | Rewrite and approve script (checkpoint 1) | 1.5 hr |
| Wed | Pipeline generates ElevenLabs voiceover, fetches stock and renders; quick listen | 0.5 to 1 hr |
| Sat | Watch render, swap bad clips, re-render (checkpoint 2) | 0.5 to 1 hr |
| Sun | Title, thumbnail, upload and schedule | 0.5 to 1 hr |

**First 10 videos:**

- [ ] 1\. What Happens to a Town When Walmart Leaves
- [ ] 2\. How a Single Amazon Warehouse Reshapes a City
- [ ] 3\. Why Every Highway Exit Has the Same 4 Restaurants
- [ ] 4\. The Economics of a Single Vending Machine
- [ ] 5\. Why Movie Theater Popcorn Costs $9
- [ ] 6\. What Happens When a Small Town Hospital Closes
- [ ] 7\. Why Dollar General Opens Stores 5 Miles Apart
- [ ] 8\. The Secret World of Shipping Containers
- [ ] 9\. What Actually Happens When You Tap Your Card
- [ ] 10\. What Happens to a City When Its Mall Dies

Backup ideas: how one Tesla Gigafactory changed rural Texas housing, what a Chick-fil-A does to the restaurants next to it, how one NFL stadium affects its city, the economics of a single gas station.

## Budget and Revenue Model

With no AI video, per-video production cost is close to zero, so the whole 90-day test costs about $70 to $150, mostly ElevenLabs.

**Monthly budget:**

| Item | USD/mo |
| --- | --- |
| Stock (Pexels, Pixabay), Earth Studio, Remotion, music, Canva | 0 |
| Voice: ElevenLabs (paid tier for commercial use) | About 22 (verify) |
| Paid stock library (optional) | 0, or verify current price |
| n8n (self-hosted) or Airtable free tier | 0 |
| **Total** | **\~22 to 50** |

No mic needed since narration is ElevenLabs. Breakeven once monetized is a few thousand views a month.

**Revenue at different view levels (approximate RPM ranges, US-heavy audience):**

| Monthly views | At $6 RPM | At $10 RPM | At $15 RPM |
| --- | --- | --- | --- |
| 10,000 | $60 | $100 | $150 |
| 50,000 | $300 | $500 | $750 |
| 250,000 | $1,500 | $2,500 | $3,750 |
| 1,000,000 | $6,000 | $10,000 | $15,000 |

RPMs are third-party estimates, not guarantees. Ad revenue starts only after joining the Partner Program (1,000 subscribers and 4,000 watch hours).

## Growth, Scaling and Monetization

Scale one channel deep before going wide; a second channel only when the audience is genuinely different.

**Phases:**

| Phase | Timing | Channels | Goal |
| --- | --- | --- | --- |
| Test | Months 1 to 3 | 1 | 12 videos, find what works |
| Build | Months 3 to 6 | 1 | Hit Partner Program threshold |
| Scale | Months 6 to 12 | 1 | 2 to 3 uploads a week, Shorts, first dubbed languages, first freelance hire |
| Expand | Year 2 | 2 to 3 | Second brand for a distinct audience (e.g. tech under the hood) on the proven pipeline |

**Scaling levers inside one channel:**

- Upload frequency: 1 a week, then 2 to 3 once the pipeline is smooth
- Shorts: 2 to 5 per long video to feed discovery
- Multi-language audio tracks with AI dubbing (Spanish, Portuguese, Hindi) instead of new channels
- Recurring series ("Economics of..." every Tuesday) to build habit
- A freelance editor or researcher so you direct instead of doing everything

**Monetization stack, in order:**

1. YouTube Partner Program ad revenue
2. Sponsors (finance apps, budgeting tools, newsletters), realistic from about 10K subscribers
3. Affiliate links for books, tools and apps mentioned in videos
4. A weekly "hidden economics" newsletter, an audience you own
5. Later: second channel, courses or a micro-SaaS spun out of the pipeline

**Multi-channel setup when the time comes:** Brand Accounts under one Google account, one AdSense account for all channels, separate tool workspaces so each brand keeps its own style and voice. Never run near-identical channels to multiply uploads; linked channels can be terminated together.

## Metrics, Decision Rules and Guardrails

Judge the test after 12 videos against three numbers, and fix packaging before changing the niche.

| Metric | Target | Where |
| --- | --- | --- |
| Click-through rate | 5%+ | YouTube Studio |
| Average view duration | 40%+ of video length | YouTube Studio |
| Views per video | Rising trend over 12 uploads | YouTube Studio |

**Decision rules:**

- After 12 videos, double down on the 2 to 3 best-performing sub-formats
- If views stay under about 1,000 per video, change titles and thumbnails before changing the niche
- No second channel until this one is monetized
- Add paid tools or AI video only when a specific gap appears, not before

**Guardrails:**

- Every video genuinely researched and distinct; no templated mass production
- Cite sources in every description
- Turn on YouTube's "altered or synthetic" disclosure when AI visuals could be mistaken for real footage
- No AI-generated fake brand imagery; real press assets for logos, storefronts and people
- Respect image rights: press kits, Wikimedia Commons, Earth Studio within Google's attribution rules
- Keep it a weekend project; consistency beats volume

## Alternatives Considered

Kept for future reference; none are in the current plan.

**Visual approaches:**

| Option | Cost (USD/mo) | Output | Why not now | Revisit when |
| --- | --- | --- | --- | --- |
| Full AI animation with a mascot (Higgsfield) | \~100 to 130 (Ultra, 3,000 credits) | \~7 videos/mo | Highest cost; \~1,400 credits per fully animated 12-min video | Channel earns and you want a stronger branded look |
| Hybrid: AI stills + Remotion motion + \~10 AI hero clips | \~50 to 80 (Plus, 1,200 credits) | \~3 videos/mo | Costs more than stock for a modest visual gain | Stock can't cover key scenes |
| Stock + motion graphics (chosen) | \~0 to 30 | Unlimited | Chosen |  |

**Higgsfield notes (if AI is added later):** Kling 3.0 about 8 credits per 5s at 1080p; Nano Banana Pro about 2 credits per image; Plus $47/mo (annual, 1,200 credits), Ultra $99/mo (annual, 3,000 credits); credits expire each cycle and re-rolls cost credits. Useful tools: Soul ID (trains a consistent mascot from 20+ reference images; set up before episode 1), Popcorn (4 to 8 frame storyboards before spending video credits), VibeVoice and Seed Audio (built-in narration and voice cloning, could replace ElevenLabs), Seed Speech (30+ languages for dubbing), Supercomputer Scheduled Tasks (scheduled posting; only after human review). Source: [Higgsfield faceless channel guide](https://higgsfield.ai/blog/start-faceless-channel-with-ai).

**Grok Imagine:** 720p video with sound, generated in under a minute; API about $0.05 per second; SuperGrok Lite $10/mo. Good for cheap bulk b-roll via API, weaker for hero shots.

**Render tools:** Creatomate (no-code JSON-to-video API, pay per render) as a faster-to-set-up alternative to Remotion.

**Niches:**

| Niche | Why not chosen |
| --- | --- |
| Baby/toddler songs and cartoons (Made for Kids) | RPM \~$0.33 to $3; comments and personalized ads disabled; YouTube Kids limits AI content; advocacy pressure for bans |
| Kids bedtime stories | Same Made for Kids problems |
| History and mythology docudramas | Good backup: \~$4 to $10 RPM, low competition, strong fit for AI visuals |
| Sleep history (1 to 6 hr) | Good backup: huge watch hours |
| Scary stories, true crime | Crowded; true crime needs care with real victims |
| Personal finance | Highest RPM but needs credibility |
| Tech under the hood | Strong personal edge; planned as an occasional episode and possible second channel |
| Reddit story narration, AI music loops, movie recaps | Policy or copyright risk |

**Automation styles reviewed:**

- Fully automated n8n + Airtable "Top 10" pipelines with daily auto-upload (Automation Tribe style): plumbing borrowed (control panel, scene JSON, render by API), strategy rejected (templated, no human input, high demonetization risk)
- "Lazy" faceless methods: outsourcing to freelancers is legitimate and the best future path to hands-off; compilations and AI slideshows with TTS are not

**Side hustles noted:** AI UGC ad creative for brands (legal only as labeled presenter/demo ads, never fake testimonials; FTC penalties up to $51,744 per violation), AI automation for small businesses, micro-SaaS, AI training/evaluation gigs.
