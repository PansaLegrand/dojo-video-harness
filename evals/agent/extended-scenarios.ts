import { setNode, type Scenario } from "./scenarios";
/** Additional held-out requests. Kept separate from the 18-case baseline. */
export const extendedScenarios: Scenario[] = [
  {
    id: "compound-request",
    category: "timeline",
    turns: [
      {
        prompt:
          "Trim the main video to five seconds from its existing start, set background music to 25%, and change the opening title to 'Intro'. Leave the closing title and all other properties alone.",
        selected: ["clip", "bed", "title"],
        expected: "edit",
        reference: [
          { type: "trimItem", id: "clip", from: 0, duration: 150 },
          setNode("bed", ["volume"], 0.25),
          setNode("title", ["text"], "Intro"),
        ],
      },
    ],
  },
  {
    id: "fractional-time",
    category: "timeline",
    turns: [
      {
        prompt:
          "Move the opening title to start at 2.5 seconds. Preserve its duration and everything else.",
        selected: ["title"],
        expected: "edit",
        reference: [{ type: "moveItem", id: "title", from: 75 }],
      },
    ],
  },
  {
    id: "named-distractor",
    category: "basic",
    turns: [
      {
        prompt:
          "Change only the closing title wording to 'Thanks for watching'. Keep the opening title untouched.",
        selected: [],
        expected: "edit",
        reference: [setNode("subtitle", ["text"], "Thanks for watching")],
      },
    ],
  },
  {
    id: "ambiguous-target",
    category: "session",
    critical: true,
    turns: [
      {
        prompt:
          "Set the title color to #2563eb. If there is more than one title, ask which one before editing.",
        selected: [],
        expected: "question",
        answer: "The opening title, keeping all other properties unchanged.",
        answerMatch: "opening",
        question: {
          question: "Which title?",
          options: [
            { id: "opening", label: "Opening title" },
            { id: "closing", label: "Closing title" },
          ],
        },
        reference: [setNode("title", ["style", "color"], "#2563eb")],
        restart: true,
      },
    ],
  },
  {
    id: "rejected-follow-up",
    category: "session",
    critical: true,
    turns: [
      {
        prompt: "Make the opening title blue (#2563eb), changing nothing else.",
        selected: ["title"],
        expected: "edit",
        reference: [setNode("title", ["style", "color"], "#2563eb")],
        reject: true,
      },
      {
        prompt:
          "I rejected that color proposal. Now change only the opening title wording to 'Launch Day'. Keep the saved color and all other properties.",
        selected: ["title"],
        expected: "edit",
        reference: [setNode("title", ["text"], "Launch Day")],
      },
    ],
  },
  {
    id: "compound-unsupported",
    category: "boundary",
    critical: true,
    turns: [
      {
        prompt:
          "Generate a new AI video and change the opening title to green. If video generation is unavailable, explain that and leave the entire project unchanged; do not make partial edits.",
        selected: [],
        expected: "advice",
        reference: [],
      },
    ],
  },
];
