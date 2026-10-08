# CLAUDE.md — استوديو مقاطع القرآن (quran-clip-studio)

Working memory for Claude sessions on this repo. Read this first; README.md is the user-facing Arabic guide.

## The user
- Talks in **Egyptian Arabic**; answer in Egyptian Arabic, short and practical. UI text in the app is Egyptian Arabic, RTL.
- Uses the app alone, mostly on desktop Chrome, sometimes mobile. Edits in Filmora.
- Subscriptions: Filmora, Higgsfield, Gemini, ChatGPT, Claude, ElevenLabs (own voice clone).
- Posts to **TikTok, Instagram, Facebook only** (not YouTube).
- TikTok: username **`@tilawat.alaaa`** (three a's; locked until 2026-11-07), display name «قرآن يريح القلب 🤍» (changeable after 2026-10-15). Profile picture = «تلاوات» crescent (`assets/profile/tiktok-avatar-tilawat.png`). Default on-video handle = `@tilawat.alaaa` (`js/templates.js`).
- Account is Quran-only; other content (e.g. the planned daily-news reels tool) goes to a separate repo + separate account.

## Hard decisions (don't re-litigate)
- Static site, **no build step**, vanilla ES modules, hosted on GitHub Pages from `main`: https://powerflash1000.github.io/quran-clip-studio/
- Everything runs in the browser; no server. Optional Cloudflare Worker CORS proxy: `tools/cors-proxy-worker.js` (allowlist of hosts).
- No AI inside the app except opt-in ElevenLabs TTS (user's own key). API keys live only in localStorage.
- Declined, with reasons — don't add: downloading videos/audio from TikTok/IG/FB/Pinterest (ToS + copyright; use official embeds for reference only), ibtihalat (copyright), Pinterest as a background source (no reuse licence).
- Hadith must show grade; weak/unknown grades warn before export.
- Video max 3 minutes in-browser (longer → Filmora package). 9:16 default. Shorts >60s warning.
- Pexels stopped issuing new API keys; keyless stock = Wikimedia Commons + Openverse; Pixabay with free key.

## Code map (`js/`)
| file | what |
|---|---|
| `main.js` | all UI wiring + state (big). `state.blocks` (quran/hadith/zikr), `state.style`, `state.mediaList`, `hadithAudio` Map (blockId → {buffer,name,url}; also used for uploaded recitations on quran blocks) |
| `slides.js` | canvas drawing: background, overlay (label, text, word reveal, footer, handle) |
| `exporter.js` | audio export (ffmpeg), SRT, ffmpeg video path, Filmora zip, `overlayFrames` |
| `fastexport.js` | WebCodecs H.264/AAC + mp4-muxer fast path (default when supported; seeks video backgrounds per frame) |
| `bglist.js` | multiple backgrounds: schedule (per ayah / every N s), crossfade, video seeking |
| `audio.js` | decode, timeline mixing (`noGap` per segment), WAV, recording, trimSilence, `sliceBuffer`, `enhanceVoice` (gate/EQ/comp/reverb presets) |
| `words.js` | word-by-word timing (Quran.com segments or approx) |
| `reciters.js` | curated reciters: EveryAyah folders, islamic.network, Quran.com recitation ids |
| `hadith.js` | fawazahmed0 hadith-api, matn extraction, grade assessment |
| `publish.js` | titles/captions/hashtags per platform (uses `b.rec.name` for uploaded reciter) |
| `automation.js` | `parseRefs` («يوسف 4-6», «2:255», Arabic digits) and `embedFor` (TikTok/IG/FB/YouTube/Pinterest embeds) |
| `stock.js` | Pixabay / Wikimedia / Openverse / Pexels search; `PROVIDERS` |
| `series.js`, `sounds.js` (Freesound), `elevenlabs.js`, `templates.js` (`DEFAULT_STYLE`), `storage.js` (`qcs:` localStorage), `quran.js`, `net.js`, `zip.js`, `ffmpeg.js` |

Data: `data/quran.json` (Uthmani + English), `data/azkar.json` (Hisn al-Muslim). Fonts: KFGQPC Uthmanic HAFS, Amiri.

## Features (all shipped)
4-step tabs (#content/#audio/#look/#export, Alt+1..4) · ayah ranges + repeat · hadith with grades · azkar library · series mode (optional) · uploaded full-surah recitation with start/end + tap-to-mark ayat (e.g. Sheikh Sayed Said from mp3quran) · recording teleprompter · ElevenLabs · voice enhance (clean/room/mosque) · silence trim · Freesound/Pixabay ambience · word-by-word reveal · hook intro + handle watermark · multiple backgrounds with crossfade · templates · MP3/M4A/WAV/MP4/PNG/SRT/Filmora · silent video · export queue (MP4/MP3/Filmora, captions file) · reference-video panel with reel recipe, screenshot palette, experiment log (views/likes, CSV) · publish panel + Web Share · project save/open.

## Testing
- Playwright: `/opt/node22/lib/node_modules/playwright/index.mjs`, Chromium preinstalled. Serve with `npx -y http-server -p 8124 -s -c-1 .` **in the same shell command** as the test (background servers die between calls).
- Mock external hosts with `page.route` (EveryAyah, ffmpeg core from jsDelivr, stock APIs). The sandbox can't reach most real APIs.
- Headless Chromium has no H.264/AAC encoder: set `window.__qcsTestCodecs = true` to allow VP9/Opus in the fast path; with it false, export falls back to ffmpeg.wasm. Check ffmpeg output with system `ffmpeg`/`ffprobe`.
- Syntax check modules with `node --input-type=module --check < file` (plain `node --check` misses module-scope errors).
- Playwright `setInputFiles` fails silently with Arabic file names — use ASCII names in tests.

## Conventions
- Comments in Egyptian Arabic, matching existing style. Keep README.md (Arabic) updated for every user-visible feature.
- Commit as `git -c user.name="Claude" -c user.email="noreply@anthropic.com"`, push to `main` (user approved working directly on main).

## Pending / ideas
- After ~1 week of posting: analyze TikTok Analytics screenshots (Followers → active hours, countries). Early data: like rate 15–18% (good); posting same surah 3× in a day got 0 views (duplicate); best hooks start with «إسمعها للآخر».
- Higgsfield voice clone paused: balance 0.69 credits, and need confirmation the sample is the user's own voice.
- Not yet approved: Tafsir Muyassar under ayah, text motion animations, cover-image generator, PWA install.
- Unverified against real services: Quran.com reciter id mapping/CORS, Wikimedia/Openverse live responses, real H.264 export on the user's machine, TikTok/IG embeds rendering.
- Separate project planned: daily news reels tool (new repo `daily-reels-studio`, new chat, separate social account).
