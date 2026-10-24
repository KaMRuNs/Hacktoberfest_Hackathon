# FairLens Architecture

## 1. Problem and users
Online and lab programming exams are hard to keep fair. A student can open ChatGPT or a messaging app in another window, and the examiner can't watch 40 screens at once. Teachers react by going back to paper exams, which is a poor fit for coding courses, and honest students lose out.

**FairLens** watches each student's screen during the exam, uses a local open-source vision model to flag moments that look like AI use or copying, and gives the examiner evidence to review. **Humans decide; the model only flags.**

- **Student:** joins with an exam code, shares their entire screen, sees a visible "Proctoring active" bar.
- **Examiner:** creates the exam, watches the live flag feed, confirms or dismisses each flag, reads the summary at the end.

## 2. System overview
```
┌──────────── Student browser ────────────┐
│ getDisplayMedia (must be "monitor")     │
│   every 2.5s → canvas grab              │
│   → 32×32 grayscale dHash               │
│   → Hamming dist vs last sent ≤ 6? drop │
│   → else JPEG ≤1024px q0.7 → POST       │
└───────────────────┬─────────────────────┘
                    │ POST /api/frames (multipart)
┌───────────────────▼─────────────────────────────────────────┐
│ Express server                                              │
│  save JPEG → storage/frames/                                │
│  cache.get(hash) ── hit ──► result {source:"cache"}         │
│        │ miss                                               │
│  queue (per student, latest-wins, 1 worker per model)       │
│        ▼                                                    │
│  analyzer: gemma4:e2b triage ──normal──► store, done        │
│        │ suspicious / uncertain                             │
│        ▼                                                    │
│  gemma4:e4b second opinion ──► flag {source:"live"}         │
│        ▼                                                    │
│  SQLite + replay recorder ──► Socket.IO "flag" → examiner   │
│                                                             │
│  end of exam: qwen3.5:4b → incident summary (text only)     │
└─────────────────────────────────────────────────────────────┘
                    │ Ollama HTTP 127.0.0.1:11434 (offline)
```

## 3. Components
| Module | Responsibility |
|---|---|
| `public/js/capture.js` | Screen capture, rejects tab/window sharing, dHash, change detection, upload |
| `routes/frames.js` | Receives a frame, stores it, checks the cache, enqueues it |
| `services/queue.js` | One slot per student: a new frame replaces a waiting one, so there's no backlog |
| `services/analyzer.js` | Two-stage model pipeline, zod validation, latency timing |
| `services/ollama.js` | `/api/chat` wrapper with speed defaults, timeout, warm-up |
| `services/cache.js` | `dHash → result` map (in memory, persisted to SQLite) |
| `services/replay.js` | Records the timeline of a real session; plays it back labelled |
| `public/examiner.html` | Student list, live flag feed with thumbnails, Confirm / Dismiss |

## 4. Model pipeline
**Triage prompt (gemma4:e2b)**, image plus:
> You are reviewing one screenshot from a student's computer during a closed-book programming exam. Allowed: code editor, terminal, the exam page. Classify what is visible. Reply ONLY with JSON.

Output schema:
```json
{ "category": "normal_ide | ai_chat | messaging | other_website | copy_from_doc | unclear",
  "suspicious": true, "confidence": 0.0, "reason": "short, what is visible" }
```
- `suspicious && confidence ≥ 0.5`, or `unclear` → send to **gemma4:e4b** with the same prompt.
- A flag is raised only if e4b agrees. Disagreement → stored as `low` severity and shown greyed.
- Invalid JSON → `unclear`, never `suspicious`.

**Summary (qwen3.5:4b, text only):** at exam end, gets the list of confirmed and pending flags (times, categories, reasons) and writes a short plain-language report per student.

## 5. Speed settings
Aim: **under 5s from screen change to examiner flag** on a laptop.

| Setting | Value | Why |
|---|---|---|
| Client downscale | ≤1024px wide, JPEG q0.7 | Image size has the biggest effect on vision latency |
| Change filter | dHash Hamming > 6 | Ignores cursor blink and clock ticks |
| `keep_alive` | `"60m"` | Model stays in memory, so there's no reload delay |
| Warm-up | `npm run warmup` at start | First call loads the weights, so do it before the demo |
| `num_predict` | 120 | Short JSON only |
| `temperature` | 0.1 | Stable classification |
| `format` | `"json"` | No parsing failures |
| Two stages | e2b for everything, e4b on suspects only | The slow model runs rarely |
| Queue | latest-wins | Stale frames are skipped, never queued up |
| Timeout | 20s → mark `unclear` | One slow call can't block the pipeline |

`npm run bench` prints the p50/p95 latency per model so you can tune these with real numbers.

## 6. Cache and replay (honest by design)
Every result carries a `source` field, and the UI always shows it as a badge.

| Source | Meaning | UI badge |
|---|---|---|
| `live` | Model ran just now on this frame | 🟢 LIVE · e2b 2.1s |
| `cache` | Identical frame hash seen before; earlier real result reused | ⚡ CACHED (identical frame) |
| `replay` | Played back from a recorded real session | ⏯ REPLAY · recorded 24 Oct |

- **Cache:** keyed by the frame's dHash, exact match only. This is a real optimisation: students often switch back to the same screen.
- **Replay:** `replay.js` records the real timeline (frames + model results + timestamps) of a session. `/examiner.html?replay=<id>` plays it back at 1× or 4× with a permanent REPLAY banner. It is used to show a full exam story quickly, **alongside** a live run, never instead of one.
- Hardcoded or hand-written model outputs are never allowed.

## 7. Data model (SQLite)
```
exams(id, code, title, duration_min, status, created_at)
students(id, exam_id, name, joined_at)                 -- fake names only
frames(id, student_id, ts, hash, path)
results(id, frame_id, model, category, suspicious, confidence,
        reason, latency_ms, source)                    -- live|cache|replay
flags(id, student_id, frame_id, severity, status, reviewed_at)
                                                        -- status: pending|confirmed|dismissed
recordings(id, exam_id, created_at, events_json)
```

## 8. API
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/exams` | Create an exam → returns its code |
| POST | `/api/exams/:code/join` | Student joins → studentId |
| POST | `/api/frames` | Upload a changed frame (multipart: image, hash, studentId) |
| GET | `/api/exams/:id/flags` | Flag list |
| PATCH | `/api/flags/:id` | Confirm / dismiss |
| POST | `/api/exams/:id/summary` | qwen3.5 report |
| GET | `/api/replays/:id` | Recorded timeline |
| GET | `/health` | Ollama reachable + models loaded |

Socket.IO events: `frame:result`, `flag:new`, `flag:update`, `student:status`.

## 9. Privacy and limits (state these openly)
- Capture runs only between exam start and end, with a visible indicator. Everything stays on the local machine/LAN, with no cloud calls.
- Frames are deleted when the examiner closes the exam (configurable).
- **Can't detect:** a phone or second device, or a person helping off-screen.
- A small vision model will make mistakes, which is why every flag needs human review.

## 10. Build order (during the event)
1. Express skeleton, `/health`, Ollama client, warm-up.
2. Student capture page: screen share, dHash, upload.
3. Analyzer: e2b triage → examiner sees results live (**first end-to-end demo**).
4. e4b second opinion, flags table, Confirm/Dismiss.
5. Cache plus source badges.
6. Replay recorder and player.
7. qwen3.5 summary, README, screenshots, submit.
