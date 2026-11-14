import { fixture, scenarios, setNode, type Scenario, type Turn } from "./scenarios";
import { extendedScenarios } from "./extended-scenarios";
import { canonicalSerialize, parseVideoProjectDocument, type VideoProjectDocument } from "../../packages/core/src/lib/video-project/document";
import { OutcomeError, type Trial } from "./grading";

/** Synthetic, deterministic timeline fixture. Media decoding/visual quality remains
 * in the retained real mixed-media and audio-explainer regression journeys. */
function laidOutFixture(kind?: Scenario["fixture"]) {
  const doc = fixture(kind);
  for (const item of doc.items) if (item.node.type === "text") Object.assign(item.node.style!, { width: 1100, height: 100 });
  return doc;
}
export function reliabilityFixture() {
  const doc = laidOutFixture();
  for (const [id, type] of [["interview", "video"], ["detail", "video"], ["photo", "image"]] as const) {
    doc.assets[id] = { id, name: id, type, source: "local", ...(type === "video" ? { durationSeconds: 30 } : {}) };
    doc.sources[id] = { assetId: id, revision: "synthetic-reliability-v1" };
  }
  doc.items.push(
    { id: "interview", name: "Interview video", trackId: "visual", node: { id: "interview", type: "video", assetId: "interview", from: 300, duration: 180, videoStartTime: 3, volume: 1 } },
    { id: "detail", name: "Detail video", trackId: "visual", node: { id: "detail", type: "video", assetId: "detail", from: 480, duration: 120, videoStartTime: 7, volume: 0 } },
    { id: "photo", name: "Product photo", trackId: "visual", node: { id: "photo", type: "img", assetId: "photo", from: 90, duration: 90, style: { opacity: 1 } } },
    { id: "english", name: "English subtitle text", trackId: "visual", node: { id: "english", type: "text", text: "Revenue grew 12% year over year.", from: 30, duration: 60, style: { color: "#ffffff", fontSize: 28, left: 40, top: 560, width: 1100, height: 45 } } },
    { id: "chinese", name: "Chinese subtitle text", trackId: "visual", node: { id: "chinese", type: "text", text: "收入同比增长12%。", from: 30, duration: 60, style: { color: "#ffff00", fontSize: 28, left: 40, top: 610, width: 1100, height: 45 } } },
  );
  return parseVideoProjectDocument(doc);
}
const edit = (prompt: string, selected: string[], reference: Turn["reference"]): Turn => ({ prompt, selected, reference, expected: "edit" });
/** Independent expected document mutations: no command compiler or reference edit
 * is used by this oracle. Extra mutations and changed source origins fail. */
function oracle(change: (expected: VideoProjectDocument, turn: number) => void): Scenario["assertOutcome"] {
  return (before, after, turn) => {
    const expected = structuredClone(before); change(expected, turn);
    const normalize = (doc: VideoProjectDocument) => {
      const copy = structuredClone(doc);
      for (const item of copy.items) if (item.node.style?.color) item.node.style.color = item.node.style.color.toLowerCase();
      return canonicalSerialize(copy);
    };
    if (normalize(expected) !== normalize(after)) throw new OutcomeError("Independent reliability outcome or preservation check failed.");
  };
}
const node = (doc: VideoProjectDocument, id: string) => doc.items.find(item => item.id === id)!.node;
const retained = ["title-color", "trim-head", "split-video", "music-volume", "question-restart-answer", "locked-track", "missing-transcript", "project-text-injection", "compound-request", "rejected-follow-up"];
export const reliabilityScenarios: Scenario[] = [
  ...retained.map(id => { const scenario = [...scenarios, ...extendedScenarios].find(item => item.id === id)!; return { ...scenario, document: laidOutFixture(scenario.fixture) }; }),
  {
    id: "three-source-reorder", category: "timeline", document: reliabilityFixture(),
    turns: [edit("Place the Detail video at zero seconds, the Interview video at four seconds, and the Main video at ten seconds. Preserve all three source in-points, durations, volume and every other item.", [], [
      { type: "moveItem", id: "detail", from: 0 }, { type: "moveItem", id: "interview", from: 120 }, { type: "moveItem", id: "clip", from: 300 },
    ])],
    assertOutcome: oracle(doc => { node(doc, "detail").from = 0; node(doc, "interview").from = 120; node(doc, "clip").from = 300; }),
  },
  {
    id: "image-placement-opacity", category: "timeline", document: reliabilityFixture(),
    turns: [edit("Move the Product photo to 8.5 seconds and set its opacity to 65%. Keep its three-second duration, all video clips and both subtitle texts unchanged.", ["photo"], [
      { type: "moveItem", id: "photo", from: 255 }, setNode("photo", ["style", "opacity"], 0.65),
    ])],
    assertOutcome: oracle(doc => { node(doc, "photo").from = 255; node(doc, "photo").style!.opacity = 0.65; }),
  },
  {
    id: "existing-bilingual-styling", category: "basic", document: reliabilityFixture(),
    turns: [edit("Set the existing English subtitle text red (#ff0000) and the Chinese subtitle text white (#ffffff). Preserve their exact wording, simultaneous timing, size and separate vertical positions. Leave all other content unchanged.", ["english", "chinese"], [setNode("english", ["style", "color"], "#ff0000"), setNode("chinese", ["style", "color"], "#ffffff")])],
    assertOutcome: oracle(doc => { node(doc, "english").style!.color = "#ff0000"; node(doc, "chinese").style!.color = "#ffffff"; }),
  },
  {
    id: "subtitle-followup-preserves-facts", category: "session", document: reliabilityFixture(), critical: true,
    turns: [
      edit("Set only the English subtitle text color to red (#ff0000), preserving the exact 12% year-over-year statement and everything else.", ["english"], [setNode("english", ["style", "color"], "#ff0000")]),
      { ...edit("Now move both existing subtitle texts to start at two seconds, preserving their durations, the red English styling and the exact English and Chinese facts. Keep all video and image timing unchanged.", ["english", "chinese"], [{ type: "moveItem", id: "english", from: 60 }, { type: "moveItem", id: "chinese", from: 60 }]), restart: true },
    ],
    assertOutcome: oracle((doc, turn) => { if (!turn) node(doc, "english").style!.color = "#ff0000"; else { node(doc, "english").from = 60; node(doc, "chinese").from = 60; } }),
  },
  {
    id: "missing-media-no-fabrication", category: "boundary", document: reliabilityFixture(), critical: true,
    turns: [{ prompt: "Replace the Product photo with the file named logo-final.png. If that file is absent from the library, explain that I need to import it and leave the whole project unchanged. Do not generate or download a replacement.", selected: ["photo"], expected: "advice", reference: [] }],
    assertOutcome: oracle(() => {}),
  },
  {
    id: "trim-offset-then-move", category: "timeline", document: reliabilityFixture(),
    turns: [edit("Trim the first second off the Interview video, then place the remaining five seconds at timeline time two seconds. Its source originally starts at 3 seconds, so the result must start at source time 4 seconds. Preserve every other item.", ["interview"], [{ type: "trimItem", id: "interview", from: 330, duration: 150 }, { type: "moveItem", id: "interview", from: 60 }])],
    assertOutcome: oracle(doc => { Object.assign(node(doc, "interview"), { from: 60, duration: 150, videoStartTime: 4 }); }),
  },
];

export function reliabilityMetrics(trials: Trial[], expected: number) {
  const passed = trials.filter(trial => trial.passed);
  return {
    expected, executed: trials.length, coverage: expected ? trials.length / expected : 0,
    firstPass: passed.filter(trial => !trial.rejectedObservations).length,
    recovered: passed.filter(trial => !!trial.rejectedObservations).length,
    noProposal: trials.filter(trial => trial.noProposal).length,
    unsafeOutcomes: trials.filter(trial => trial.invariantFailure).length,
    failed: trials.filter(trial => !trial.passed).length,
    modelCalls: trials.reduce((count, trial) => count + trial.calls, 0),
    modelCallsNotDispatched: trials.reduce((count, trial) => count + (trial.notDispatchedCalls ?? 0), 0),
    // No invented dollar estimate: prices and cache billing vary by provider/model.
    providerCostUsd: null,
    firstRequests: trials.map(trial => ({ scenarioId: trial.scenarioId, repetition: trial.repetition, ...trial.firstRequest })),
  };
}

export function assertKieEvaluationEndpoint(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.hostname !== "api.kie.ai" || url.port || url.username || url.password || url.search || url.hash || url.pathname !== "/codex/v1/responses")
    throw new Error("Reliability evaluation permits only https://api.kie.ai/codex/v1/responses; Vercel Gateway and other destinations are rejected.");
  return url.href;
}
