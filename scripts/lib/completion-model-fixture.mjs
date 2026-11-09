import assert from "node:assert/strict";
// Scripted provider declarations for the existing browser scenarios. Independent
// timeline/media assertions remain unchanged; these are not live-model evidence.
export function withCompletionReview(context, body, response) {
  if (
    response.name !== "propose_edit" ||
    !body.tools.some((tool) => tool.name === "review_edit")
  )
    return response;
  const edit = response.args,
    commands = edit.commands;
  for (const call of body.input
    .filter(
      (item) => item.type === "function_call" && item.name === "review_edit",
    )
    .reverse()) {
    const args = JSON.parse(call.arguments),
      output = body.input.find(
        (item) =>
          item.type === "function_call_output" && item.call_id === call.call_id,
      );
    if (
      output &&
      JSON.stringify(args.edit.commands) === JSON.stringify(commands)
    ) {
      const review = JSON.parse(output.output).completionPreflight;
      assert.equal(review.status, "passed", JSON.stringify(review.checks));
      return response;
    }
  }
  const requirements = [],
    covered = new Set();
  const originals = commands.filter(
    (command) => command.type === "captionSource",
  );
  for (const original of originals) {
    const translated = commands.find(
      (command) =>
        command.type === "addItem" &&
        command.item.caption?.role === "translation" &&
        command.item.caption.sourceItemId === original.sourceItemId,
    )?.item;
    if (!translated) continue;
    const color =
      commands
        .filter(
          (command) =>
            command.type === "set" &&
            command.target.itemId === original.itemId &&
            command.path.join(".") === "style.color",
        )
        .at(-1)?.value ?? "#ffffff";
    requirements.push({
      id: `captions-${requirements.length}`,
      kind: "caption_pair",
      sourceItemId: original.sourceItemId,
      evidenceId: original.evidenceId,
      originalItemId: original.itemId,
      translatedItemId: translated.id,
      originalLanguage: "en",
      translatedLanguage: translated.caption.language,
      originalColor: color,
      translatedColor: translated.node.style.color,
    });
    covered.add(original.itemId);
    covered.add(translated.id);
  }
  for (const anchor of commands.filter(
    (command) => command.type === "anchorSpeech",
  )) {
    const graphic = commands.find(
      (command) =>
        command.type === "insertGraphic" && command.itemId === anchor.itemId,
    );
    if (!graphic?.node.text) continue;
    requirements.push({
      id: `highlight-${requirements.length}`,
      kind: "speech_highlight",
      itemId: anchor.itemId,
      bindingId: anchor.id,
      sourceItemId: anchor.sourceItemId,
      evidenceId: anchor.evidenceId,
      wordIds: anchor.wordIds,
      exactText: graphic.node.text,
      minReadableMs: 1000,
    });
    covered.add(anchor.itemId);
  }
  for (const graphic of commands.filter(
    (command) =>
      command.type === "insertGraphic" &&
      (command.node.from ?? 0) >= context.document.format.durationInFrames,
  )) {
    if (graphic.node.text) {
      requirements.push({
        id: `ending-${requirements.length}`,
        kind: "appended_ending",
        itemId: graphic.itemId,
        exactText: graphic.node.text,
        minDurationMs: 1000,
        animated: true,
      });
      covered.add(graphic.itemId);
    }
  }
  for (const [index, command] of commands.entries()) {
    const itemId =
      command.itemId ??
      command.item?.id ??
      command.target?.itemId ??
      command.id;
    if (covered.has(itemId)) continue;
    if (command.type === "set" || command.type === "clear") {
      if (
        command.target.kind === "format" &&
        command.path[0] === "durationInFrames" &&
        requirements.some(
          (requirement) => requirement.kind === "appended_ending",
        )
      )
        continue;
      requirements.push({
        id: `field-${index}`,
        kind: command.type === "clear" ? "property_absent" : "property",
        target: command.target,
        path: command.path,
        ...(command.type === "set" ? { equals: command.value } : {}),
      });
    } else if (
      ["insertGraphic", "insertSvg", "addItem", "captionSource"].includes(
        command.type,
      )
    )
      requirements.push({
        id: `present-${index}`,
        kind: "item_present",
        itemId,
      });
    else if (command.type === "removeItem")
      requirements.push({
        id: `absent-${index}`,
        kind: "item_absent",
        itemId: command.id,
      });
    else if (command.type === "moveItem")
      requirements.push({
        id: `move-${index}`,
        kind: "property",
        target: { kind: "node", itemId: command.id, nodeId: command.id },
        path: ["from"],
        equals: command.from,
      });
  }
  assert(
    requirements.length && requirements.length <= 12,
    "Browser model fixture must declare 1–12 intended outcomes",
  );
  return { name: "review_edit", args: { requirements, edit } };
}
