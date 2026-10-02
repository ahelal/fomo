import React from 'react';
import { IMPORTANCE_LABEL, type DigestEntry, type Update } from '@fomo/core';

interface Props {
  entry: DigestEntry;
  sourceLabels?: Record<string, string>;
  onOpenItem(update: Update): void;
  onMarkRead(): void;
  /** Saved view only: mark the topic's updates unread again. */
  onMarkUnread?(): void;
  onClose(): void;
  /** `saved` shows the topic's saved updates, marking the unread ones. */
  mode?: 'digest' | 'saved';
}

/** Copilot summary + highlights for a topic, with the updates it groups. */
export function TopicPane({ entry, sourceLabels = {}, onOpenItem, onMarkRead, onMarkUnread, onClose, mode = 'digest' }: Props) {
  const { topic, items } = entry;
  const label = (s: string) => sourceLabels[s] ?? s;
  const saved = mode === 'saved';
  const unread = items.filter((u) => u.status === 'unread').length;

  return (
    <div className="detail-pane topic-pane">
      <p className="detail-pane__title">{topic.title}</p>
      <div className="detail-pane__meta">
        {topic.importance && (
          <div className="detail-pane__meta-row">
            <span>Importance</span>
            <span className={`topic-pane__importance topic-pane__importance--${topic.importance}`}>
              {topic.importance === 'high' ? '▲ ' : ''}{IMPORTANCE_LABEL[topic.importance]}
            </span>
          </div>
        )}
        <div className="detail-pane__meta-row">
          <span>
            {items.length} {saved ? 'saved ' : ''}update{items.length === 1 ? '' : 's'}
            {saved && unread > 0 ? ` (${unread} unread)` : ''}
          </span>
          <span className="detail-pane__meta-val">{entry.sources.map(label).join(', ')}</span>
        </div>
        <div className="detail-pane__meta-row">
          <span>Latest</span>
          <span className="detail-pane__meta-val">{entry.latestDate.slice(0, 10)}</span>
        </div>
      </div>

      {saved ? (
        <div className="detail-pane__actions">
          <button className="btn btn--primary" onClick={onMarkRead} disabled={unread === 0}>r · Mark topic read</button>
          {onMarkUnread && <button className="btn" onClick={onMarkUnread}>u · Mark topic unread</button>}
        </div>
      ) : (
        <>
          <div className="detail-pane__mobile-actions">
            <button className="btn btn--primary" onClick={onMarkRead}>✓ Read&Next</button>
            <button className="btn" onClick={onClose}>Close</button>
          </div>
          <div className="detail-pane__actions">
            <button className="btn btn--primary" onClick={onMarkRead}>x · Mark topic read</button>
          </div>
        </>
      )}

      {topic.summary && <p className="topic-pane__summary">{topic.summary}</p>}
      {topic.highlights.length > 0 && (
        <ul className="topic-pane__highlights">
          {topic.highlights.map((h, i) => <li key={i}>{h}</li>)}
        </ul>
      )}

      <div className="topic-pane__items">
        {items.map((u) => (
          <div key={u.id} className="topic-pane__item">
            <button className="topic-pane__item-title" onClick={() => onOpenItem(u)}>
              <span className="topic-pane__item-meta">{u.datePublished.slice(0, 10)} · {label(u.source)}</span>
              <span>
                {saved
                  ? u.status === 'unread' && <span className="digest-row__unread" title="Unread">● </span>
                  : u.saved && '⭐ '}
                {u.title}
              </span>
              {u.summary && <span className="topic-pane__item-summary">{u.summary}</span>}
            </button>
            <a className="topic-pane__item-link" href={u.url} target="_blank" rel="noreferrer noopener" title="Open">↗</a>
          </div>
        ))}
      </div>
    </div>
  );
}
