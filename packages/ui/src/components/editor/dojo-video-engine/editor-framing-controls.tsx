'use client';
import React from 'react';
import type { SceneNodeInput, SceneStyle } from '@dojo-video-engine/schema';
import { useTranslation } from '@/lib/i18n';
import { EditorField } from './editor-fields';
import { editorFocalPointPatch, readEditorFocalPoint } from './editor-framing';
import { editorFramingCopy } from './editor-framing-copy';

export function EditorFraming({ node, disabled, onChange, onPreview }: { node: SceneNodeInput; disabled: boolean; onChange: (patch: Partial<SceneStyle>) => void; onPreview: (patch: Partial<SceneStyle> | null) => void }) {
  const { locale } = useTranslation(), t = (label: string) => locale === 'en' ? label : editorFramingCopy[locale]?.[label] ?? label;
  const focal = readEditorFocalPoint(node), unavailable = focal.kind === 'animated' || focal.kind === 'unsupported';
  if (focal.kind === 'unsupported') return null;
  const change = (action: Parameters<typeof editorFocalPointPatch>[1], preview = false) => {
    // A remote edit can change eligibility while a numeric draft is focused.
    if (disabled || unavailable || action.kind === 'position' && (focal.kind !== 'simple' || node.style?.objectFit !== 'cover')) { if (preview) onPreview(null); return; }
    const patch = editorFocalPointPatch(node, action); (preview ? onPreview : onChange)(patch);
  };
  return <details className="space-y-3 rounded border border-[var(--editor-border)] p-3" data-editor-framing>
    <summary className="cursor-pointer text-xs font-medium text-[var(--editor-text)]">{t('Crop & focal point')}</summary>
    <p className="text-[11px] leading-5 text-[var(--editor-muted)]">{t('Fill the frame, then move the visible area. Original media stays unchanged.')}</p>
    {focal.kind === 'animated' && <p role="status" className="text-[11px] leading-5 text-[var(--editor-muted)]">{t('Custom framing animation is preserved. These controls are unavailable.')}</p>}
    {focal.kind === 'custom' && <p role="status" className="text-[11px] leading-5 text-[var(--editor-muted)]">{t('This position uses custom units. Center the focal point to use percentage controls.')}</p>}
    <fieldset disabled={disabled || unavailable} className="space-y-3">
      <button type="button" className="editor-secondary-button" disabled={node.style?.objectFit === 'cover'} onClick={() => change({ kind: 'crop' })}>{t('Crop to fill')}</button>
      <div className="grid grid-cols-2 gap-2">{(['x', 'y'] as const).map(axis => <EditorField key={axis} label={t(axis === 'x' ? 'Focal point X (%)' : 'Focal point Y (%)')} type="number" min={0} max={100} step={1} value={focal.kind === 'simple' ? focal[axis] : 50} disabled={focal.kind !== 'simple' || node.style?.objectFit !== 'cover'}
        onCommit={value => change({ kind: 'position', axis, value: Number(value) })}
        onPreview={value => value === null ? onPreview(null) : change({ kind: 'position', axis, value: Number(value) }, true)} />)}</div>
      <button type="button" className="editor-secondary-button" onClick={() => change({ kind: 'center' })}>{t('Center focal point')}</button>
    </fieldset>
  </details>;
}
