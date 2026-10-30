import type { EditorTransition } from '@/lib/editor/composition-schema';
import { executeVideoProjectCommands, type VideoProjectCommand } from '@/lib/video-project/commands';
import type { VideoProjectDocument } from '@/lib/video-project/document';

export const EDITOR_TRANSITION_REASONS = [
  'Choose a video or image clip.', 'Use two clips on the first video track.', 'Clips must touch without a gap or overlap.',
  'Add a video or image clip immediately after this clip.', 'Unlock the track to edit transitions.',
  'Use plain video or image clips for this transition.', 'Use an opaque project and clip background.',
  'Remove clip animation, masks, transforms or effects first.', 'Use full-frame clips without borders, padding or rounded corners.',
  'Use forward playback without looping.', 'Shorten the transition to fit both clips.',
  'Source duration is unavailable. Try a picture-only dip to black.',
  'There are not enough unused source frames. Shorten the transition or use a picture-only dip to black.',
  'Existing audio fades or ducking are preserved. Turn off Blend audio.', 'Another transition uses this edge. Remove it first.',
  'Nearby transitions overlap. Shorten this transition.', 'The transition could not be applied. Check the current clips and try again.',
] as const;
export type EditorTransitionSettings = { kind: EditorTransition['kind']; durationFrames: number; blendAudio: boolean };
export type EditorTransitionTarget = { from: VideoProjectDocument['items'][number] | undefined; next: VideoProjectDocument['items'][number] | undefined;
  existing: EditorTransition | undefined; maximumFrames: number; cut?: number; reason: string | null };
export function editorTransitionTarget(document: VideoProjectDocument, itemId: string | null): EditorTransitionTarget {
  const from = document.items.find(item => item.id === itemId), existing = Object.values(document.transitions ?? {}).find(value => value.fromItemId === itemId);
  if (!from || !['video', 'img'].includes(from.node.type)) return { from, next: undefined, existing, maximumFrames: 0, reason: 'Choose a video or image clip.' };
  if (document.tracks.find(track => track.kind === 'visual')?.id !== from.trackId) return { from, next: undefined, existing, maximumFrames: 0, reason: 'Use two clips on the first video track.' };
  const cut = (from.node.from ?? 0) + from.node.duration!, neighbors = document.items.filter(item => item.id !== from.id && item.trackId === from.trackId), next = neighbors.filter(item => (item.node.from ?? 0) === cut);
  const overlap = neighbors.some(item => (item.node.from ?? 0) < cut && (item.node.from ?? 0) + item.node.duration! > (from.node.from ?? 0));
  const reason = next.length !== 1 || overlap ? next.length || overlap || neighbors.some(item => (item.node.from ?? 0) > cut)
    ? 'Clips must touch without a gap or overlap.' : 'Add a video or image clip immediately after this clip.' : null;
  const maximumFrames = next.length === 1 ? Math.min(2_592_000, 2 * from.node.duration! + 1, 2 * next[0].node.duration!) : 0;
  return { from, next: next.length === 1 ? next[0] : undefined, existing, maximumFrames, cut, reason };
}
export function editorTransitionDefaults(document: VideoProjectDocument, itemId: string | null): EditorTransitionSettings {
  const target = editorTransitionTarget(document, itemId);
  return target.existing ? { kind: target.existing.kind, durationFrames: target.existing.durationFrames, blendAudio: target.existing.audio === 'crossfade' }
    : { kind: 'dissolve', durationFrames: Math.max(2, Math.min(Math.round(document.format.fps / 2), target.maximumFrames || 2)), blendAudio: false };
}
export function editorTransitionReason(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : '';
  if ((EDITOR_TRANSITION_REASONS as readonly string[]).includes(message)) return message;
  if (/unlock|locked/i.test(message)) return 'Unlock the track to edit transitions.';
  if (/first video track/.test(message)) return 'Use two clips on the first video track.';
  if (/meet at the same cut|overlap another clip/.test(message)) return 'Clips must touch without a gap or overlap.';
  if (/two plain/.test(message)) return 'Use plain video or image clips for this transition.';
  if (/opaque/.test(message)) return 'Use an opaque project and clip background.';
  if (/unanimated/.test(message)) return 'Remove clip animation, masks, transforms or effects first.';
  if (/full-frame|padding or margins/.test(message)) return 'Use full-frame clips without borders, padding or rounded corners.';
  if (/forward, non-looping/.test(message)) return 'Use forward playback without looping.';
  if (/longer than/.test(message)) return 'Shorten the transition to fit both clips.';
  if (/duration is unknown/.test(message)) return 'Source duration is unavailable. Try a picture-only dip to black.';
  if (/unused source frames/.test(message)) return 'There are not enough unused source frames. Shorten the transition or use a picture-only dip to black.';
  if (/gain automation or ducking/.test(message)) return 'Existing audio fades or ducking are preserved. Turn off Blend audio.';
  if (/only one transition/.test(message)) return 'Another transition uses this edge. Remove it first.';
  if (/transitions overlap/.test(message)) return 'Nearby transitions overlap. Shorten this transition.';
  return 'The transition could not be applied. Check the current clips and try again.';
}
/** Construct a small native batch and validate its complete composition footprint.
 * No preview derivative, trim, source offset or audio automation is persisted. */
export function buildEditorTransitionCommands(document: VideoProjectDocument, itemId: string, settings: EditorTransitionSettings, newId: string): VideoProjectCommand[] {
  const target = editorTransitionTarget(document, itemId);
  if (target.reason || !target.from || !target.next) throw new Error(target.reason ?? 'Choose a video or image clip.');
  if (!Number.isInteger(settings.durationFrames) || settings.durationFrames < 2 || settings.durationFrames > target.maximumFrames) throw new Error('Shorten the transition to fit both clips.');
  if (!target.existing && document.transitions?.[newId]) throw new Error('Another transition uses this edge. Remove it first.');
  const transition: EditorTransition = { id: target.existing?.id ?? newId, fromItemId: target.from.id, toItemId: target.next.id, kind: settings.kind, durationFrames: settings.durationFrames, audio: settings.blendAudio ? 'crossfade' : 'pictureOnly' };
  const commands: VideoProjectCommand[] = [{ type: 'setTransition', transition }];
  executeVideoProjectCommands(document, commands); return commands;
}
export function removeEditorTransitionCommands(document: VideoProjectDocument, itemId: string): VideoProjectCommand[] {
  const existing = editorTransitionTarget(document, itemId).existing;
  if (!existing) throw new Error('The transition could not be applied. Check the current clips and try again.');
  const commands: VideoProjectCommand[] = [{ type: 'removeTransition', id: existing.id }]; executeVideoProjectCommands(document, commands); return commands;
}
