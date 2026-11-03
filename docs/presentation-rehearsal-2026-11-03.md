# One-request presentation rehearsal — 2026-11-03

The local harness can prepare a visual proposal and a background-music plan from
one instruction. `prepare_background_music` accepts `continueEditing: true` to
return an observation and keep the bounded agent loop running. Its default stays
terminal for standalone music requests. Neither mode generates paid music or
applies document edits. The user reviews/applies visuals and separately approves
one music generation plus insertion.

The rehearsal uses two owned six-second portrait clips in a 20-second project:
animated 3–2–1 countdown (0–3s), clips (3–9s and 9–15s), a lower-third, closing
title (15–20s), and a 20-second instrumental music plan at 18% volume. This is a
controlled product example, not general creative-quality qualification.

## Reproduce with your own fixtures

Create `assets/Coffee Arrival.mp4`, `assets/Coffee Moment.mp4` and `Instruction.txt`
in a private directory. Each source clip must contain at least six seconds.
Install FFmpeg/ffprobe. Set `DEMO_DIR` to that directory, then:

```sh
# Creates a fresh local project; no model or music charge.
npx tsx scripts/rehearse-presentation.ts

# Optional: set LLM_API_KEY privately; at most eight GPT planning calls.
npx tsx scripts/rehearse-presentation.ts --live
```

`LLM_BASE_URL` and `LLM_MODEL` select a GPT-compatible Responses endpoint. The
script writes a report and candidate document under the private `.build/` folder.
Start the app with `DATA_DIR="$DEMO_DIR/.data" PORT=4326 npm start` after building,
and open the returned local URL. Configure provider keys privately in Settings
or the host environment. The script never approves music or exports video.

## Checks and boundaries

- New regression tests cover standalone termination and compound continuation,
  a single music plan, unchanged saved document, and a separately reviewable edit.
- The revised full instruction used four live GPT planning calls and passed all
  assertions, including clip order, countdown animation, text, format, music plan
  and independently evaluated lower-third bounds (x=28, y=1064, 664×120 pixels).
- A single approved Kie V6 job returned usable audio. The durable host stored it
  locally and inserted one 20-second item at 18% volume at revision 3.
- Rendering exposed a valid-color spelling mismatch in engine 1.1.1. Engine 1.1.2 is published. The upstream
  fix compares canonical paint sources while retaining tamper rejection. Regression
  cases cover uppercase hex, padded hex/named/functional colors and shape paint.
- The first rendered output exposed an unbounded title plate. The final prompt
  supplies explicit dimensions; `motion-design.md` now explains this constraint,
  and the rehearsal oracle checks evaluated geometry. A fresh model run, browser
  comparison and decoded 20-second visual export passed with the revised request.
- The first project's plate was corrected through chat, compared and applied while
  preserving its already generated music. Its final 720×1280 H.264/AAC export fully
  decoded at 30 fps / 20 seconds; independent audio comparison measured gain 0.17994
  and correlation 0.99998 after a measured 11.02 ms codec-priming offset. No second
  music generation was submitted for the visual retest.
- These runs separate model-plan, actual-render, paid-provider and decoded-media
  evidence. Preserve that distinction when presenting the demo.

No recording-media files, API keys, provider settings or private job payloads are
committed. The commercial SaaS does not acquire the local music service by copying
this UI; its worker, billing and storage adapters require separate integration.
