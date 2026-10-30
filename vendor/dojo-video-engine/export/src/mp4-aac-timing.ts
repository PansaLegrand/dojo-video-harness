import { AacTimingError } from "./aac-timing-error";

export const MAX_AAC_MOOV_BYTES = 8 * 1024 * 1024;
type Box = { type: string; header: number; body: Uint8Array; children?: Box[]; parts?: Uint8Array[] };
const containers = new Set(["moov", "trak", "mdia", "minf", "stbl", "edts"]);
function fail(message: string): never { throw new AacTimingError("AAC_TIMING_UNSUPPORTED", message); }
const safe = (value: number) => { if (!Number.isSafeInteger(value) || value < 0) fail("MP4 timing contains an unsafe integer."); return value; };
const ascii = (bytes: Uint8Array, at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
const view = (box: Box) => new DataView(box.body.buffer, box.body.byteOffset, box.body.byteLength);
const u32 = (box: Box, at: number) => { if (at < 0 || at + 4 > box.body.length) fail(`Truncated MP4 ${box.type} metadata.`); return view(box).getUint32(at); };
function child(box: Box, type: string): Box { const matches = box.children?.filter(value => value.type === type) ?? []; if (matches.length !== 1) fail(`Expected one ${type} box in ${box.type}.`); return matches[0]!; }
function parse(bytes: Uint8Array): Box {
  let count = 0;
  const list = (data: Uint8Array, depth: number): Box[] => {
    if (depth > 12) fail("MP4 timing metadata is nested too deeply.");
    const result: Box[] = [], values = new DataView(data.buffer, data.byteOffset, data.byteLength);
    for (let at = 0; at < data.length;) {
      if (at + 8 > data.length || ++count > 10000) fail("Invalid or oversized MP4 metadata structure.");
      const raw = values.getUint32(at), header = raw === 1 ? 16 : 8;
      if (at + header > data.length) fail("Truncated MP4 metadata header.");
      const size = safe(raw === 1 ? Number(values.getBigUint64(at + 8)) : raw || data.length - at);
      if (size < header || at + size > data.length) fail("Invalid MP4 metadata box size.");
      const type = ascii(data, at + 4), body = data.subarray(at + header, at + size);
      result.push({ type, header, body, ...(containers.has(type) ? { children: list(body, depth + 1) } : {}) }); at += size;
    }
    return result;
  };
  const roots = list(bytes, 0);
  if (roots.length !== 1 || roots[0]!.type !== "moov") fail("AAC timing repair requires a regular MP4 moov box.");
  if (roots[0]!.children?.some(box => box.type === "mvex")) fail("Fragmented MP4 AAC timing repair is not supported.");
  return roots[0]!;
}
function size(box: Box): number { return box.header + (box.children ? box.children.reduce((total, child) => total + size(child), 0) : box.parts ? box.parts.reduce((total, part) => total + part.length, 0) : box.body.length); }
function encode(box: Box): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(size(box)), data = new DataView(bytes.buffer);
  const write = (node: Box, at: number) => {
    const length = size(node); data.setUint32(at, node.header === 16 ? 1 : length);
    for (let i = 0; i < 4; i++) bytes[at + 4 + i] = node.type.charCodeAt(i);
    if (node.header === 16) data.setBigUint64(at + 8, BigInt(length));
    let offset = at + node.header;
    if (node.children) for (const nested of node.children) { write(nested, offset); offset += size(nested); }
    else for (const part of node.parts ?? [node.body]) { bytes.set(part, offset); offset += part.length; }
  };
  write(box, 0); return bytes;
}
function table(type: string, rows: number[][]): Box {
  const width = rows[0]?.length ?? (type === "stsc" ? 3 : 2), body = new Uint8Array(8 + rows.length * width * 4), data = new DataView(body.buffer);
  data.setUint32(4, rows.length); rows.forEach((row, index) => row.forEach((value, field) => { safe(value); if (value > 0xffffffff) fail("MP4 table value exceeds its integer width."); data.setUint32(8 + (index * width + field) * 4, value); }));
  return { type, header: 8, body };
}
function rows(box: Box, width: number): number[][] {
  const count = u32(box, 4);
  if (box.body[0] !== 0 || box.body.length !== 8 + count * width * 4 || count > MAX_AAC_MOOV_BYTES / (width * 4)) fail(`Unsupported ${box.type} table.`);
  return Array.from({ length: count }, (_, index) => Array.from({ length: width }, (_, field) => u32(box, 8 + (index * width + field) * 4)));
}
function replace(parent: Box, previous: Box, next: Box) { const index = parent.children!.indexOf(previous); if (index < 0) fail("Missing MP4 table to replace."); parent.children![index] = next; }
function timeHeader(box: Box) {
  const version = box.body[0]; if (version !== 0 && version !== 1) fail(`Unsupported ${box.type} version.`);
  const scaleOffset = version === 0 ? 12 : 20, durationOffset = version === 0 ? 16 : 24, width = version === 0 ? 4 : 8;
  const timescale = u32(box, scaleOffset); if (!timescale || box.body.length < durationOffset + width) fail("Invalid MP4 time base.");
  return { version, timescale, durationOffset, width };
}
function setDuration(box: Box, value: number, trackHeader = false) {
  safe(value); const version = box.body[0]; if (version !== 0 && version !== 1) fail(`Unsupported ${box.type} version.`);
  const offset = trackHeader ? version === 0 ? 20 : 28 : version === 0 ? 16 : 24, width = version === 0 ? 4 : 8;
  if (box.body.length < offset + width || width === 4 && value > 0xffffffff) fail("AAC timing exceeds the existing MP4 duration width.");
  box.body = new Uint8Array(box.body); const data = view(box);
  if (width === 8) data.setBigUint64(offset, BigInt(value)); else data.setUint32(offset, value);
}
function durationOf(box: Box, trackHeader = false): number {
  const version = box.body[0]; if (version !== 0 && version !== 1) fail("Unsupported MP4 duration version.");
  const offset = trackHeader ? version === 0 ? 20 : 28 : version === 0 ? 16 : 24;
  if (box.body.length < offset + (version === 0 ? 4 : 8)) fail("Truncated MP4 duration.");
  return safe(version === 0 ? u32(box, offset) : Number(view(box).getBigUint64(offset)));
}
function gcd(a: number, b: number): number { while (b) [a, b] = [b, a % b]; return a; }
function retimeMovie(root: Box, oldScale: number, newScale: number) {
  if (oldScale === newScale) return;
  const movie = child(root, "mvhd"), movieHeader = timeHeader(movie);
  movie.body = new Uint8Array(movie.body); view(movie).setUint32(movieHeader.version === 0 ? 12 : 20, newScale);
  for (const track of root.children!.filter(box => box.type === "trak")) {
    const media = child(track, "mdia"), header = child(track, "tkhd"), edit = track.children!.find(box => box.type === "edts");
    if (edit) {
      const list = child(edit, "elst"), version = list.body[0], count = u32(list, 4), width = version === 0 ? 12 : version === 1 ? 20 : 0;
      if (!width || list.body.length !== 8 + count * width || count > 2) fail("Unsupported existing MP4 edits.");
      list.body = new Uint8Array(list.body); let total = 0;
      for (let i = 0; i < count; i++) {
        const at = 8 + i * width, old = version === 0 ? u32(list, at) : safe(Number(view(list).getBigUint64(at)));
        const next = safe(Math.round(old / oldScale * newScale)); total += next;
        if (version === 0) { if (next > 0xffffffff) fail("MP4 edit duration overflow."); view(list).setUint32(at, next); }
        else view(list).setBigUint64(at, BigInt(next));
      }
      setDuration(header, total, true);
    } else {
      const mediaHeader = child(media, "mdhd");
      setDuration(header, Math.round(durationOf(mediaHeader) / timeHeader(mediaHeader).timescale * newScale), true);
    }
  }
}
function offsets(box: Box): number[] {
  const count = u32(box, 4), width = box.type === "co64" ? 8 : 4;
  if (box.body[0] !== 0 || box.body.length !== 8 + count * width) fail("Invalid MP4 chunk offsets.");
  return Array.from({ length: count }, (_, index) => safe(width === 8 ? Number(view(box).getBigUint64(8 + index * width)) : u32(box, 8 + index * width)));
}
function offsetTable(type: "stco" | "co64", values: number[]): Box {
  const width = type === "co64" ? 8 : 4, body = new Uint8Array(8 + values.length * width), data = new DataView(body.buffer); data.setUint32(4, values.length);
  values.forEach((value, index) => { safe(value); if (width === 8) data.setBigUint64(8 + index * width, BigInt(value)); else { if (value > 0xffffffff) fail("MP4 chunk offset overflow."); data.setUint32(8 + index * width, value); } });
  return { type, header: 8, body };
}
export type AacMoovTiming = { sampleRate: number; sampleCount: number; primingSamples: number };
export type AacMoovRepair = { data: Uint8Array<ArrayBuffer>; position: number; growth: number; retainedPackets: number; removedPaddingPackets: number; primingSamples: number; sampleCount: number };

/** Rewrites only timing/sample tables. Every referenced and unreferenced mdat byte remains untouched. */
export function repairAacMoov(bytes: Uint8Array, position: number, timing: AacMoovTiming, maxBytes = MAX_AAC_MOOV_BYTES): AacMoovRepair {
  safe(position); safe(timing.sampleRate); safe(timing.sampleCount); safe(timing.primingSamples);
  if (!timing.sampleRate || !timing.sampleCount || timing.primingSamples > timing.sampleRate / 2) fail("AAC calibration or presentation length is outside supported bounds.");
  if (bytes.length > maxBytes) throw new AacTimingError("AAC_TIMING_BUDGET", "AAC timing metadata exceeds its bounded budget.");
  const root = parse(bytes), movie = child(root, "mvhd"), oldMovieScale = timeHeader(movie).timescale;
  // Millisecond movie ticks cannot express most 30/60fps audio endpoints.
  // Raise only the movie clock; encoded samples keep their native time bases.
  const movieScale = safe(oldMovieScale / gcd(oldMovieScale, timing.sampleRate) * timing.sampleRate);
  if (movieScale > 0xffffffff) fail("MP4 movie clock exceeds its supported width.");
  retimeMovie(root, oldMovieScale, movieScale);
  const tracks = root.children!.filter(box => box.type === "trak"), audioTracks = tracks.filter(track => ascii(child(child(track, "mdia"), "hdlr").body, 8) === "soun");
  if (audioTracks.length !== 1) fail("AAC timing repair requires exactly one encoded audio track.");
  const track = audioTracks[0]!, media = child(track, "mdia"), mediaHeader = child(media, "mdhd"), audioScale = timeHeader(mediaHeader).timescale;
  if (audioScale !== timing.sampleRate) fail("AAC output uses an unsupported media time base.");
  const samples = child(child(media, "minf"), "stbl"), description = child(samples, "stsd");
  if (u32(description, 4) !== 1 || ascii(description.body, 12) !== "mp4a" || samples.children!.some(box => ["ctts", "cslg", "stss", "sbgp", "sgpd", "stz2"].includes(box.type))) fail("AAC output has unsupported sample tables.");
  const wanted = safe(timing.primingSamples + timing.sampleCount), originalTimes = child(samples, "stts"), nextTimes: number[][] = [];
  let remaining = wanted, retainedPackets = 0;
  for (const [count, delta] of rows(originalTimes, 2)) {
    if (!count || !delta) fail("Invalid AAC sample duration.");
    const whole = Math.min(count!, Math.floor(remaining / delta!));
    if (whole) { nextTimes.push([whole, delta!]); retainedPackets += whole; remaining -= whole * delta!; }
    if (remaining && whole < count!) { nextTimes.push([1, remaining]); retainedPackets++; remaining = 0; }
    if (!remaining) break;
  }
  if (remaining) fail("Encoded AAC does not cover the complete requested audio timeline.");
  replace(samples, originalTimes, table("stts", nextTimes));
  const sizes = child(samples, "stsz"), fixedSize = u32(sizes, 4), packetCount = u32(sizes, 8);
  if (retainedPackets > packetCount || sizes.body.length !== 12 + (fixedSize ? 0 : packetCount * 4)) fail("Invalid AAC packet sizes.");
  const sizeHeader = new Uint8Array(sizes.body.subarray(0, 12)); new DataView(sizeHeader.buffer).setUint32(8, retainedPackets);
  sizes.parts = fixedSize ? [sizeHeader] : [sizeHeader, sizes.body.subarray(12, 12 + retainedPackets * 4)];
  const chunkOffsets = samples.children!.filter(box => box.type === "stco" || box.type === "co64"); if (chunkOffsets.length !== 1) fail("Ambiguous AAC chunk offsets.");
  const originalOffsets = chunkOffsets[0]!, values = offsets(originalOffsets), originalChunks = child(samples, "stsc"), chunks = rows(originalChunks, 3), nextChunks: number[][] = [], keptOffsets: number[] = [];
  if (!chunks.length || chunks[0]![0] !== 1) fail("Invalid AAC chunk table.");
  for (let index = 0; index < chunks.length; index++) if (!chunks[index]![1] || chunks[index]![2] !== 1 || index && chunks[index]![0]! <= chunks[index - 1]![0]!) fail("Unsupported AAC chunk structure.");
  remaining = retainedPackets; let entry = 0;
  for (let index = 0; index < values.length && remaining; index++) {
    while (entry + 1 < chunks.length && chunks[entry + 1]![0]! <= index + 1) entry++;
    const count = Math.min(chunks[entry]![1]!, remaining);
    if (!nextChunks.length || nextChunks.at(-1)![1] !== count) nextChunks.push([index + 1, count, 1]);
    keptOffsets.push(values[index]!); remaining -= count;
  }
  if (remaining) fail("AAC chunks do not cover their sample table.");
  replace(samples, originalChunks, table("stsc", nextChunks)); replace(samples, originalOffsets, offsetTable(originalOffsets.type as "stco" | "co64", keptOffsets));
  const movieDuration = safe(Math.round(timing.sampleCount / timing.sampleRate * movieScale));
  if (Math.round(movieDuration / movieScale * timing.sampleRate) !== timing.sampleCount) fail("MP4 movie time base cannot represent the requested audio sample boundary.");
  const version = movieDuration > 0xffffffff ? 1 : 0, editBody = new Uint8Array(version ? 28 : 20), editView = new DataView(editBody.buffer);
  editBody[0] = version; editView.setUint32(4, 1);
  if (version) { editView.setBigUint64(8, BigInt(movieDuration)); editView.setBigInt64(16, BigInt(timing.primingSamples)); editView.setUint32(24, 0x10000); }
  else { editView.setUint32(8, movieDuration); editView.setInt32(12, timing.primingSamples); editView.setUint32(16, 0x10000); }
  track.children = track.children!.filter(box => box.type !== "edts"); track.children.splice(1, 0, { type: "edts", header: 8, body: new Uint8Array(), children: [{ type: "elst", header: 8, body: editBody }] });
  setDuration(mediaHeader, wanted); setDuration(child(track, "tkhd"), movieDuration, true);
  let totalDuration = movieDuration;
  for (const other of tracks) if (other !== track) {
    const header = child(other, "tkhd"), version = header.body[0], offset = version === 0 ? 20 : 28;
    const duration = safe(version === 0 ? u32(header, offset) : Number(view(header).getBigUint64(offset)));
    totalDuration = Math.max(totalDuration, duration);
  }
  setDuration(movie, totalDuration);
  // An end-moov stream never needs truncation; retain harmless free metadata if
  // removal of padding entries made its replacement smaller than the old box.
  if (size(root) < bytes.length) root.children!.push({ type: "free", header: 8, body: new Uint8Array(Math.max(0, bytes.length - size(root) - 8)) });
  const allOffsets: Array<{ parent: Box; box: Box; values: number[] }> = [];
  const collect = (node: Box) => { for (const nested of node.children ?? []) { if (nested.type === "stco" || nested.type === "co64") allOffsets.push({ parent: node, box: nested, values: offsets(nested) }); else collect(nested); } }; collect(root);
  const boundary = safe(position + bytes.length);
  for (const entry of allOffsets) for (const offset of entry.values) if (offset >= position && offset < boundary) fail("A media chunk points into MP4 metadata.");
  let again = true;
  while (again) {
    again = false; const growth = size(root) - bytes.length;
    for (const entry of allOffsets) if (entry.box.type === "stco" && entry.values.some(offset => offset >= boundary && offset + growth > 0xffffffff)) {
      const upgraded = offsetTable("co64", entry.values); replace(entry.parent, entry.box, upgraded); entry.box = upgraded; again = true;
    }
  }
  const growth = size(root) - bytes.length;
  for (const entry of allOffsets) replace(entry.parent, entry.box, offsetTable(entry.box.type as "stco" | "co64", entry.values.map(offset => safe(offset >= boundary ? offset + growth : offset))));
  if (size(root) > maxBytes) throw new AacTimingError("AAC_TIMING_BUDGET", "Corrected AAC timing metadata exceeds its bounded budget.");
  return { data: encode(root), position, growth, retainedPackets, removedPaddingPackets: packetCount - retainedPackets, primingSamples: timing.primingSamples, sampleCount: timing.sampleCount };
}
