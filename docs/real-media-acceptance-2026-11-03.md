# Real-media workflow acceptance

Date: 2026-11-03. Status: bounded automated acceptance passed; human listening
and final user acceptance remain pending.

## Source and reproduction

The source is **Digital Show & Tell**, Monty Montgomery / Xiph.Org Foundation,
distributed by its author under [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/).
[Source page](https://xiph.org/video/vid2.shtml),
[360p WebM](https://downloads.xiph.org/video/Digital_Show_and_Tell-360p.webm),
[author-supplied English VTT](https://xiph.org/video/02-Digital_Show_and_Tell.en.vtt).
The download mirror `https://ftp.osuosl.org/pub/xiph/video/` served the video.
No endorsement by the source author is implied.

Download the source and VTT to a local folder. Then run:

```sh
node scripts/prepare-real-media.mjs --source /absolute/path/Digital_Show_and_Tell-360p.webm --captions /absolute/path/source.en.vtt
npm run build
REAL_MEDIA_ONLY=1 REAL_MEDIA_FILE="$PWD/test-results/real-media-inputs/speech.mp4" BROWSER_TEST_OUTPUT_DIR=test-results/real-media node scripts/browser-smoke.mjs
```

Preparation verifies both original SHA-256 values, then creates a 90-second
excerpt (source seconds 8–98), normalized to 640×360, 30 fps, H.264/AAC and BT.709.
It writes provenance next to the derived file; the browser gate verifies that
binding before importing. Tests further trim/fit the excerpt, overlay text and
adjust gain. Derived videos remain CC BY-SA 3.0, with `ATTRIBUTION.md` beside the
outputs. Media and the full transcript remain ignored; the committed
[source manifest](reports/real-media-source-2026-11-03.json) contains provenance.

## Accepted bounded cases

| Case             | Workflow                                                                              | Independent result                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Speech excerpt   | 10.2-second nonzero source window, reference caption, review/apply/reopen/export/save | 306 decoded frames; sampled speech correlation >0.999; zero measured sample-window lag               |
| Portrait montage | Two six-second windows of real footage fitted within 360×640; readable title          | 360 decoded frames; sampled source/canvas agreement; speech correlation >0.96 and <1 ms measured lag |
| Longer speech    | 60 seconds, nonzero source offset, gain 0.8, temporary lower-third                    | 1,800 decoded frames; beginning/middle/end speech checks; measured lag variation <1 ms               |

The actual React editor, IndexedDB imports, local host, command validation,
comparison/Apply, browser export and local save run. Every output is tied to the
applied revision/document hash and stored bytes. FFmpeg independently constructs
references, fully decodes outputs, checks dimensions/frame count, compares sampled
image regions outside overlays, and measures speech correlation/gain/lag.

Frozen tolerances: sample correlation >0.94, gain error <1 dB, first-to-last lag
variation <one 30-fps frame, and sampled RGB mean error <16/255 with ±one-frame
matching around source sampling. [Measured report](reports/real-media-2026-11-03.json).

Model responses are scripted. Source windows are explicitly specified fixture
inputs. The caption is supplied reference text from the author's timed subtitle,
not new ASR or fabricated word evidence. No paid model, transcription or generation
call occurred. These cases do not qualify semantic speech editing or live-model
interpretation of new requests.

## Failures and review findings retained

- An initial fixture shortened project duration before trimming its imported item;
  the kernel correctly rejected cutting off timeline items. The final proposal
  trims items before reducing the timeline.
- A synthetic instruction labelled “speech” triggered the genuine-word evidence
  guard. Explicit source-window test instructions now distinguish manual timestamp
  edits from semantic speech requests; the guard remains unchanged.
- Re-encoding the independent reference to AAC, and subsequently quantizing it to
  16-bit PCM, distorted a near-silent window. Floating-point PCM removes this
  reference loss. The original correlation/gain thresholds were retained, and
  earlier failures remain under local `test-results/real-media-v3/` and `v4/`.
- Center-cropping the landscape speaker cut off his face. Visual review rejected
  that composition; the final portrait case fits the full source with letterboxing.
  Automatic subject-aware crop selection is not implemented or qualified.

Final local artifacts are under `test-results/real-media-v6/`. Exported frames
were visually inspected for readable overlays and preserved content. Human
listening and subjective cut/caption quality are still awaiting user review.
This is one licensed source at a declared 60-second ceiling. Physical-phone
rotation/VFR, multiple real speakers/languages, longer/high-resolution recordings,
and cross-browser acceptance remain open.
