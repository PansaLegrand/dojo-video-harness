'use client';
import React from 'react';
import type { VideoProjectAgentRun } from '@/lib/video-project/agent-types';
import { useNativeEditorText } from './native-editor-copy';
const button = 'rounded border border-[var(--editor-border)] px-3 py-2 text-xs text-[var(--editor-text)] hover:bg-[var(--editor-hover)] disabled:opacity-40';
export function EditorClarification({ run, value, disabled, stale, retryPending, onChange, onAnswer, onRetry }: {
  run: VideoProjectAgentRun; value: string; disabled: boolean; stale: boolean; retryPending: boolean;
  onChange: (value: string) => void; onAnswer: (optionId?: string) => void; onRetry: () => void;
}) {
  const t = useNativeEditorText(), question = run.clarification, included = run.clarificationReply?.remaining === 1;
  if (!question) return null;
  return <div className="editor-agent-question">
    <p className="editor-authoring-notice">{t(included ? 'One model-assisted reply is included. Media generation and transcription are charged separately.' : 'The included reply has been used. Start a new edit to continue.')}</p>
    {stale && included && <p role="status">{t('The project changed after this question. Revise the request using the current project.')}</p>}
    {question.options?.map(option => {
      const summary = run.clarificationReply?.options[option.id];
      return <button key={option.id} type="button" className={button} disabled={disabled || stale || retryPending || !included || !summary} onClick={() => onAnswer(option.id)}>
        {option.label}{summary && <small data-clarification-scope={summary.scope.kind}>{t('Reply scope')}: {t(summary.scope.kind === 'project' ? 'Whole project' : summary.scope.kind === 'range' ? 'Time range' : 'Selected items')} · {summary.itemCount}
          {summary.scope.kind === 'range' && ` · ${(summary.scope.fromFrame / summary.fps).toFixed(2)}–${((summary.scope.fromFrame + summary.scope.durationInFrames) / summary.fps).toFixed(2)} s`}
          {summary.itemNames.length > 0 && <span className="block">{summary.itemNames.join(', ')}</span>}
        </small>}
      </button>;
    })}
    {included && question.allowText !== false && <>
      <textarea aria-label={t('Your reply')} maxLength={1000} rows={2} value={value} disabled={disabled || stale || retryPending} onChange={event => onChange(event.target.value)} />
      <small>{t('Your reply keeps the original edit scope.')}</small>
      <button type="button" className={button} disabled={disabled || stale || retryPending || !value.trim()} onClick={() => onAnswer()}>{t('Send answer')}</button>
    </>}
    {retryPending && <button type="button" className={button} disabled={disabled} onClick={onRetry}>{t('Retry included reply')}</button>}
  </div>;
}
