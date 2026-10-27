# CLAUDE.md — استوديو مقاطع القرآن (quran-clip-studio)

Working memory for Claude sessions on this repo. Read this first; README.md is the user-facing Arabic guide.

## The user
- Talks in **Egyptian Arabic**; answer in Egyptian Arabic, short and practical. UI text in the app is Egyptian Arabic, RTL.
- Uses the app alone, mostly on desktop Chrome, sometimes mobile. Edits in Filmora.
- Subscriptions: Filmora, Higgsfield, Gemini, ChatGPT, Claude, ElevenLabs (own voice clone).
- Posts to **TikTok, Instagram, Facebook only** (not YouTube).
- TikTok: username **`@tilawat.alaa`** (two a's — confirmed by the user 2026-10-26, https://www.tiktok.com/@tilawat.alaa), display name «قرآن يريح القلب 🤍». Profile picture = «تلاوات» crescent (`assets/profile/tiktok-avatar-tilawat.png`). Default on-video handle = `@tilawat.alaa` (`js/templates.js`; saved styles/templates with the old `@tilawat.alaaa` are migrated on load). YouTube channel planned with the same handle.
- Facebook Page: now «قرآن يريح القلب» (id 412303765486859, was «كيف دخل هؤلاء إلى الإسلام», ~1000 followers), switched to Creator page type 2026-10-15. IG↔Page linking was blocked by an ads restriction on the personal FB profile (since 2024-03-26; legacy 2014 ad account 74737627 with unsettled flag + missing payment method). 2026-10-15: Meta support cleared it after a Visa was added (account spending limit set to $1, balance $0). Retry linking via business.facebook.com as the personal profile after ~24h; fallback = trusted second full-control admin links IG.
- Account is Quran-only; other content (e.g. the planned daily-news reels tool) goes to a separate repo + separate account.

## Hard decisions (don't re-litigate)
- Static site, **no build step**, vanilla ES modules, hosted on GitHub Pages from `main`: https://powerflash1000.github.io/quran-clip-studio/
- Everything runs in the browser; no server. Optional Cloudflare Worker CORS proxy: `tools/cors-proxy-worker.js` (allowlist of hosts).
- AI inside the app is opt-in only, with the user's own key (localStorage): ElevenLabs TTS, Gemini TTS `js/geminitts.js` (free tier, falls back to the assistant's Gemini key, audioMode 'gtts', duas/azkar/custom text only — never Quran), and since 2026-10-23 the writing assistant `js/llm.js` (Gemini default/free tier — only on a project with no billing account, OpenRouter `:free` models priced 0 via its public models list, OpenAI, or Claude `claude-opus-5-5` via direct-browser header). The assistant writes hooks, captions/titles/hashtags and polishes custom text only — its system prompt forbids writing/quoting/paraphrasing Quran or hadith, tafsir, attributions, invented fadail, engagement bait. Never route religious text generation through it.
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
| `mediastore.js` | IndexedDB persistence of background files (+ per-item secs) |
| `bglist.js` | multiple backgrounds: schedule (per ayah / every N s), crossfade, video seeking |
| `audio.js` | decode, timeline mixing (`noGap` per segment), WAV, recording, trimSilence, `sliceBuffer`, `enhanceVoice` (gate/EQ/comp/reverb presets) |
| `words.js` | word-by-word timing: quran-align data (`data/wbw/<EveryAyah folder>/<surah>.json`, word starts in 1/100 s, -1 unknown; 12 recitations, CC BY 4.0) → Quran.com segments → approx. `alignFolder(reciter)` (reciter.align overrides, e.g. Husary_64kbps for Husary_128kbps) |
| `reciters.js` | curated reciters: EveryAyah folders, islamic.network, Quran.com recitation ids |
| `hadith.js` | fawazahmed0 hadith-api, matn extraction, grade assessment |
| `publish.js` | titles/captions/hashtags per platform (uses `b.rec.name` for uploaded reciter) |
| `automation.js` | `parseRefs` («يوسف 4-6», «2:255», Arabic digits) and `embedFor` (TikTok/IG/FB/YouTube/Pinterest embeds) |
| `planner.js` | Hijri dates (Intl umalqura), upcoming occasions, post log (`qcs:posts`), duplicate/spacing warnings, suggested slots |
| `stats.js` | CSV parsing (TikTok Studio export or any table with Views) + analysis by hour/day/reciter/surah/hook/duration |
| `automark.js` | auto ayah boundaries for an uploaded recitation: pause detection (RMS env) + DP choosing pauses that fit ayah lengths. Good on short ranges; long surahs with mid-ayah waqf can drift → user reviews |
| `vframes.js` | Mediabunny (vendor/mediabunny 1.60.0, MPL-2.0) sequential decode of video backgrounds for fast export; requests precomputed per source in frame order; falls back to seekVideo. ~7× faster export in test |
| `llm.js` | writing assistant: providers table, `askJson` (lenient JSON parse), `suggestHooks`, `writeCaption`, `polishText`, `ping`. UI: #ai-hooks chips, #pub-ai, polish button on custom blocks, settings `llmProvider/llmKey/llmModel` |
| `stock.js` | Pixabay / Wikimedia / Openverse / Pexels search; `PROVIDERS` |
| `series.js`, `sounds.js` (Freesound), `elevenlabs.js`, `templates.js` (`DEFAULT_STYLE`), `storage.js` (`qcs:` localStorage), `quran.js`, `net.js`, `zip.js`, `ffmpeg.js` |

Data: `data/quran.json` (Uthmani + English), `data/azkar.json` (Hisn al-Muslim). Fonts: KFGQPC Uthmanic HAFS, Amiri.

## Features (all shipped)
4-step tabs (#content/#audio/#look/#export, Alt+1..4) · ayah ranges + repeat · hadith with grades · azkar library · series mode (optional) · uploaded full-surah recitation with start/end + tap-to-mark ayat (e.g. Sheikh Sayed Said from mp3quran) · recording teleprompter · ElevenLabs · voice enhance (clean/room/mosque) · silence trim · Freesound/Pixabay ambience · word-by-word reveal · hook intro + handle watermark · multiple backgrounds with crossfade · templates · MP3/M4A/WAV/MP4/PNG/SRT/Filmora · silent video · export queue (MP4/MP3/Filmora, captions file) · reference-video panel with reel recipe, screenshot palette, experiment log (views/likes, CSV) · publish panel + Web Share (+ «✅ نشرته» post log) · project save/open · 📅 planner (Hijri occasions, duplicate warnings, slots) · Tafsir Muyassar as a «translation» option · 📊 stats dashboard · ✍️ custom text block (`type:'zikr', custom:true`, label/ref, auto seconds until edited) · ✨ writing assistant (hooks, captions, polish).

## Testing
- Playwright: `/opt/node22/lib/node_modules/playwright/index.mjs`, Chromium preinstalled. Serve with `npx -y http-server -p 8124 -s -c-1 .` **in the same shell command** as the test (background servers die between calls).
- Mock external hosts with `page.route` (EveryAyah, ffmpeg core from jsDelivr, stock APIs). The sandbox can't reach most real APIs.
- Headless Chromium has no H.264/AAC encoder: set `window.__qcsTestCodecs = true` to allow VP9/Opus in the fast path; with it false, export falls back to ffmpeg.wasm. Check ffmpeg output with system `ffmpeg`/`ffprobe`.
- Syntax check modules with `node --input-type=module --check < file` (plain `node --check` misses module-scope errors).
- Playwright `setInputFiles` fails silently with Arabic file names — use ASCII names in tests.

## Conventions
- Comments in Egyptian Arabic, matching existing style. Keep README.md (Arabic) updated for every user-visible feature.
- Bump the version string `20261013a`-style in index.html (`?v=` on main.js/style.css + `#app-version` in the footer) on each user-visible deploy, so the user can confirm they have the new build.
- Commit as `git -c user.name="Claude" -c user.email="noreply@anthropic.com"`, push to `main` (user approved working directly on main).

## Pending / ideas
- After ~1 week of posting: analyze TikTok Analytics screenshots (Followers → active hours, countries). Early data: like rate 15–18% (good); posting same surah 3× in a day got 0 views (duplicate); best hooks start with «إسمعها للآخر».
- Higgsfield voice clone paused: balance 0.69 credits, and need confirmation the sample is the user's own voice.
- Not yet approved: text motion animations, cover-image generator, PWA install.
- Tafsir source (spa5k tafsir_api slug `ar-tafsir-muyassar`, fallback Quran.com tafsir id 16) is unverified live.
- Unverified against real services: Quran.com reciter id mapping/CORS, Wikimedia/Openverse live responses, real H.264 export on the user's machine, TikTok/IG embeds rendering.
- Separate project planned: daily news reels tool (new repo `daily-reels-studio`, new chat, separate social account).
- Live mode (2026-10-24, `🔴 بث`, section in `js/main.js`): a queue played in a popup window that OBS captures (browsers can't push RTMP). Items split into ≤10-ayah parts (memory), next part prebuilt while the current one plays, drawing driven by the popup's rAF from a hidden main-document canvas (fonts live in the main document). After-queue: loop / continue in mushaf / wait screen. Keeps an «تلاوة مسجّلة» badge on by default (Meta/TikTok rules on pre-recorded live); YouTube is the recommended platform for 24/7.
- Control room (2026-10-27, `🎛️ غرفة التحكم`, non-modal `#dlg-ctrl`): scenes (style subset + bg subset by file name + fx) on hotkeys 1–9 in both windows with a 700 ms snapshot crossfade; particles/Ken Burns/lower third/ticker/clock/prayer (AlAdhan)/logo/QR/full-screen card/Lottie stickers drawn by `js/livefx.js` over the live canvas, corner layout avoids overlaps. OBS control via obs-websocket v5 in `js/obs.js` (ws://127.0.0.1:4455, SHA-256 auth). Vendored: `vendor/lottie/lottie_light_canvas.min.js` (MIT), `vendor/qrcode/qrcode.js` (MIT), loaded on demand.
- One-click reel (`🪄`): `js/themes.js` holds curated, self-contained ayah ranges per theme + hooks + stock keywords; avoid editing refs without checking they are complete in meaning.
