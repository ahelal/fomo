import React from 'react';
import type { Update, Status } from '@fomo/core';

interface Props {
  update: Update;
  onSetStatus(id: string, status: Status): void;
  onToggleSaved(id: string, saved: boolean): void;
  onFetchContent(id: string): void;
}

const STATUS_OPTIONS: { label: string; value: Status }[] = [
  { label: 'u · Unread', value: 'unread' },
  { label: 'r · Read', value: 'read' },
];

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1000);
}

export function DetailPane({ update, onSetStatus, onToggleSaved, onFetchContent }: Props) {
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
      </div>

      <a
        className="detail-pane__url"
        href={update.url}
        target="_blank"
        rel="noreferrer noopener"
      >
        {update.url}
      </a>

      <div className="detail-pane__actions">
        {STATUS_OPTIONS.filter((o) => o.value !== update.status).map((o) => (
          <button
            key={o.value}
            className="btn"
            onClick={() => onSetStatus(update.id, o.value)}
          >
            {o.label}
          </button>
        ))}
        <button
          className="btn"
          onClick={() => onToggleSaved(update.id, !update.saved)}
        >
          {update.saved ? '★ Unsave' : '☆ Save'}
        </button>
      </div>

      {hasContent ? (
        <pre className="detail-pane__content">{content}</pre>
      ) : (
        <p className="detail-pane__no-preview">
          No preview — press <kbd>p</kbd> to fetch content or <kbd>o</kbd> to{' '}
          <a href={update.url} target="_blank" rel="noreferrer noopener">
            open in browser ↗
          </a>
          <button
            className="btn"
            style={{ marginLeft: 8 }}
            onClick={() => onFetchContent(update.id)}
          >
            Fetch content
          </button>
        </p>
      )}
    </div>
  );
}
