import React from 'react';
import type { Update, Status } from '@fomo/core';
import { DuplicateLinks } from './DuplicateLinks.js';

interface Props {
  update: Update;
  onSetStatus(id: string, status: Status): void;
  onToggleSaved(id: string, saved: boolean): void;
  /** Content is still being loaded (lists are fetched without it). */
  contentLoading?: boolean;
  onReadAndNext?(): void;
  onNextUnread?(): void;
  onOpen?(): void;
  /** File the update in References (m). */
  onFileReference?(): void;
  onClose?(): void;
  /** The other updates of this update's duplicate group, original first; they are listed at the bottom. */
  duplicates?: readonly Update[];
  /** Ids of the updates in the current view, which can be jumped to. */
  listed?: ReadonlySet<string>;
  onJumpDuplicate?(id: string): void;
  labelOf?(source: string): string;
  colorOf?(source: string): string | undefined;
}

const NO_IDS: ReadonlySet<string> = new Set();
const sourceId = (source: string) => source;
const noColor = () => undefined;

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1000);
}

export function DetailPane({
  update, onSetStatus, onToggleSaved, contentLoading, onReadAndNext, onNextUnread, onOpen, onFileReference, onClose,
  duplicates = [], listed = NO_IDS, onJumpDuplicate, labelOf = sourceId, colorOf = noColor,
}: Props) {
  const hasContent = !!update.content;
  const content = hasContent ? stripHtml(update.content) : '';

  return (
    <div className="detail-pane">
      <p className="detail-pane__title">{update.title}</p>

      <div className="detail-pane__meta">
        <div className="detail-pane__meta-row">
          <span>Source</span>
          <span className="detail-pane__meta-val">{update.source}</span>
        </div>
        <div className="detail-pane__meta-row">
          <span>Published</span>
          <span className="detail-pane__meta-val">{update.datePublished.slice(0, 10)}</span>
        </div>
        <div className="detail-pane__meta-row">
          <span>Status</span>
          <span className="detail-pane__meta-val">{update.status}{update.saved ? ' ⭐' : ''}</span>
        </div>
        {update.duplicateOf && (
          <div className="detail-pane__meta-row">
            <span>Duplicate</span>
            <span className="detail-pane__meta-val dup-badge">of {update.duplicateOf.slice(0, update.duplicateOf.indexOf('__'))}</span>
          </div>
        )}
      </div>

      <a
        className="detail-pane__url"
        href={update.url}
        target="_blank"
        rel="noreferrer noopener"
      >
        {update.url}
      </a>

      {/* Mobile-only quick actions: shown when callbacks provided */}
      {(onReadAndNext || onNextUnread || onOpen || onClose) && (
        <div className="detail-pane__mobile-actions">
          {onReadAndNext && (
            <button className="btn btn--primary" onClick={onReadAndNext}>Read&Next</button>
          )}
          {onNextUnread && (
            <button className="btn btn--primary" onClick={onNextUnread}>NextUnread</button>
          )}
          {onOpen && (
            <button className="btn" onClick={onOpen}>↗ Open</button>
          )}
          {onFileReference && (
            <button className="btn" onClick={onFileReference}>🔖 Ref</button>
          )}
          {onClose && (
            <button className="btn" onClick={onClose}>Close</button>
          )}
        </div>
      )}

      {/* Desktop action buttons */}
      <div className="detail-pane__actions">
        <button
          className="btn"
          onClick={() => onSetStatus(update.id, update.status === 'unread' ? 'read' : 'unread')}
        >
          r · Mark {update.status === 'unread' ? 'read' : 'unread'}
        </button>
        <button
          className="btn"
          onClick={() => onToggleSaved(update.id, !update.saved)}
        >
          p · {update.saved ? '★ Not pending' : '☆ Pending'}
        </button>
        {onFileReference && (
          <button className="btn" onClick={onFileReference} title="File in References (m)">
            m · 🔖 Reference
          </button>
        )}
      </div>

      {update.gist && (
        <section className="detail-pane__gist" aria-label="Summary">
          <p className="detail-pane__gist-label">✦ Summary</p>
          <p className="detail-pane__gist-summary">{update.gist.summary}</p>
          {update.gist.points.length > 0 && (
            <ul className="detail-pane__gist-points">
              {update.gist.points.map((point, i) => <li key={i}>{point}</li>)}
            </ul>
          )}
        </section>
      )}

      {hasContent ? (
        <pre className="detail-pane__content">{content}</pre>
      ) : contentLoading ? (
        <p className="detail-pane__no-preview">Loading…</p>
      ) : (
        <p className="detail-pane__no-preview">
          No preview — press <kbd>o</kbd> to{' '}
          <a href={update.url} target="_blank" rel="noreferrer noopener">
            open in browser ↗
          </a>
        </p>
      )}

      <DuplicateLinks
        source={update.source}
        duplicates={duplicates}
        listed={listed}
        onJump={(id) => onJumpDuplicate?.(id)}
        labelOf={labelOf}
        colorOf={colorOf}
      />
    </div>
  );
}
