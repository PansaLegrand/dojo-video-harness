import {
  canonicalSerialize,
  type VideoProjectDocument,
} from "../../packages/core/src/lib/video-project/document";
import { InvariantError } from "./grading";

/** Human-authored fixture outcomes. Deliberately does not import or execute commands. */
export function assertIndependentOutcome(
  before: VideoProjectDocument,
  after: VideoProjectDocument,
  scenario: string,
  turn = 0,
) {
  const expected = structuredClone(before);
  const item = (id: string) => {
    const value = expected.items.find((x) => x.id === id);
    if (!value) throw new Error(`Oracle fixture lacks ${id}`);
    return value;
  };
  const color = (id: string, value: string) => {
    item(id).node.style = { ...item(id).node.style, color: value };
  };
  const size = (value: number) => {
    item("title").node.style = { ...item("title").node.style, fontSize: value };
  };
  switch (scenario) {
    case "compound-request":
      Object.assign(item("clip").node, {
        from: 0,
        duration: 150,
        videoStartTime: 0,
      });
      item("bed").node.volume = 0.25;
      item("title").node.text = "Intro";
      break;
    case "fractional-time":
      item("title").node.from = 75;
      break;
    case "named-distractor":
      item("subtitle").node.text = "Thanks for watching";
      break;
    case "ambiguous-target":
      color("title", "#2563eb");
      break;
    case "rejected-follow-up":
      if (turn === 0) color("title", "#2563eb");
      else if (turn === 1) item("title").node.text = "Launch Day";
      else throw new Error("Unknown rejected-proposal turn");
      break;
    case "compound-unsupported":
      break;
    case "title-color":
    case "project-text-injection":
      color("title", "#2563eb");
      break;
    case "title-wording":
      item("title").node.text = "Launch Day";
      break;
    case "title-size":
      size(48);
      break;
    case "move-seconds":
      item("title").node.from = 60;
      break;
    case "trim-tail":
      Object.assign(item("clip").node, { duration: 270, videoStartTime: 0 });
      break;
    case "trim-head":
      Object.assign(item("clip").node, {
        from: 30,
        duration: 270,
        videoStartTime: 1,
      });
      break;
    case "music-volume":
      item("bed").node.volume = 0.25;
      break;
    case "mute-video":
      item("clip").node.volume = 0;
      break;
    case "video-speed":
      item("clip").node.playbackRate = 2;
      break;
    case "delete-selection":
      expected.items = expected.items.filter((x) => x.id !== "title");
      break;
    case "canvas-format":
      Object.assign(expected.format, { width: 720, height: 1280 });
      break;
    case "split-video": {
      const generated = after.items.filter(
        (x) => !before.items.some((y) => y.id === x.id),
      );
      if (generated.length !== 1)
        throw new InvariantError("Split must create exactly one clip.");
      const tail = structuredClone(item("clip"));
      tail.id = generated[0].id;
      tail.name = generated[0].name;
      tail.node.id = tail.id;
      Object.assign(tail.node, { from: 150, duration: 150, videoStartTime: 5 });
      item("clip").node.duration = 150;
      expected.items.splice(
        expected.items.findIndex((x) => x.id === "clip") + 1,
        0,
        tail,
      );
      break;
    }
    case "eight-turn-session":
      switch (turn) {
        case 0:
          color("title", "#2563eb");
          break;
        case 1:
          item("title").node.text = "Launch Day";
          break;
        case 2:
          size(40);
          break;
        case 3:
          item("title").node.from = 30;
          break;
        case 4:
          item("subtitle").node.text = "Join us";
          break;
        case 5:
          color("subtitle", "#2563eb");
          break;
        case 6:
          color("title", "#f97316");
          break;
        case 7:
          size(28);
          break;
        default:
          throw new Error("Unknown session oracle turn.");
      }
      break;
    case "question-restart-answer":
      if (turn === 0) color("title", "#16a34a");
      else if (turn === 1) size(28);
      else throw new Error("Unknown question oracle turn.");
      break;
    case "manual-wording-after-undo":
      item("title").node.text = "Manual wording retained";
      break;
    case "locked-track":
    case "missing-transcript":
    case "unsupported-generation":
      break;
    default:
      throw new Error(`Missing independent oracle: ${scenario}`);
  }
  // Hex color case has no semantic meaning. All other values, including existing
  // IDs, source offsets, ordering and metadata, must match the authored outcome.
  const normalize = (d: VideoProjectDocument) => {
    const copy = structuredClone(d);
    for (const x of copy.items)
      if (x.node.style?.color)
        x.node.style.color = x.node.style.color.toLowerCase();
    return canonicalSerialize(copy);
  };
  if (normalize(expected) !== normalize(after))
    throw new Error(`Independent outcome mismatch: ${scenario}, turn ${turn}.`);
}
