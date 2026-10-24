# CLAUDE.md

Guidance for Claude Code (and humans) working in this repo.

## Project
**FairLens**: an offline AI exam proctor for university programming exams. The student's browser captures their screen every ~2.5s, sends only frames that *changed*, and a local open-source vision model (Gemma 4 via Ollama) flags suspicious activity (AI chat, messaging, other websites, copying). An examiner reviews each flag with the screenshot as evidence and confirms or dismisses it. The model never punishes on its own.

Built solo for the IIUC Hackathon (ML Bangladesh). See [ARCHITECTURE.md](ARCHITECTURE.md) for the design.

## Hard rules (from the hackathon rulebook, do not break)
1. **Open-source models only.** All AI calls go to local Ollama. Never add OpenAI, Anthropic, Gemini or any closed API SDK.
2. **No faked output.** Anything shown as model output must be produced live, or be clearly labelled in the UI as `cached` or `replay`. Never hardcode answers.
3. **Sample data only.** Fake student names. No real personal data. Never commit screenshots of real people.
4. **Never commit** model weights, `.env`, `*.db`, or the `storage/` folder.
5. **All code is written during the event.** Commit every 30–45 minutes with clear messages.

## Models (stored in `D:\ollama-models`, `OLLAMA_MODELS` env var)
| Model | Role |
|---|---|
| `gemma4:e2b` | Fast triage of every changed frame (default live model) |
| `gemma4:e4b` | Second opinion, only on frames e2b marked suspicious |
| `qwen3.5:4b` | Text only: writes the end-of-exam incident summary from the flag log |

Model names live in `.env` / `src/config.js`. Don't hardcode them elsewhere.

## Stack
- Node.js 20+ (ES modules), Express 5, Socket.IO
- SQLite via `better-sqlite3` (single file `data/fairlens.db`)
- Frontend: plain HTML + vanilla JS + CSS in `public/` (no build step)
- Ollama HTTP API at `http://127.0.0.1:11434`

## Commands
```bash
npm install
npm run dev        # node --watch src/server.js, port 3000
npm run warmup     # loads models into memory, prints latency per model
npm run bench      # times triage on sample images in samples/
npm test           # vitest
```

## Layout
```
src/
  server.js            # Express + Socket.IO bootstrap
  config.js            # env + model names + speed settings
  db.js                # SQLite schema + queries
  routes/              # exams, frames, flags, replay
  services/
    ollama.js          # thin client: chat(), vision(), keepAlive
    analyzer.js        # triage → second opinion pipeline
    queue.js           # per-student latest-wins queue
    cache.js           # frame-hash → result cache
    replay.js          # record + play back sessions
public/
  student.html         # join exam, share screen, capture loop
  examiner.html        # live grid, flag feed, review buttons
  js/capture.js        # getDisplayMedia + dHash + upload
storage/frames/        # saved JPEGs (gitignored)
samples/               # fake demo screenshots for bench/tests
```

## Conventions
- API responses: `{ success, message?, ...data }`.
- Every model result stored with `source`: `"live" | "cache" | "replay"`, plus `model` and `latency_ms`. The UI must show `source`.
- Model output must be strict JSON (`format: "json"`). Validate with zod and treat anything invalid as `uncertain`, never as `suspicious`.
- Prefer small, readable functions. Match existing style.

## Speed settings (keep these; see ARCHITECTURE.md §5)
`keep_alive: "60m"`, `num_predict: 120`, `temperature: 0.1`, `format: "json"`, images downscaled to ≤1024px JPEG q0.7 on the client.
