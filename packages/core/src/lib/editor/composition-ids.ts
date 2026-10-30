/** Stable, bounded derived IDs; authoring item/source IDs are never replaced. */
export function derivedCompositionId(
  prefix: string,
  identity: string,
  occupied: Set<string>,
) {
  let hash = 2166136261;
  for (const character of `${prefix}\0${identity}`)
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  const base = `${prefix.slice(0, 130)}:derived:${(hash >>> 0).toString(36)}`;
  let id = base,
    suffix = 0;
  while (occupied.has(id)) id = `${base}:${++suffix}`;
  occupied.add(id);
  return id;
}
