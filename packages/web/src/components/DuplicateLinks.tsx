import React from 'react';
import { formatDate, type Update } from '@fomo/core';

interface Props {
  /** Source of the update being viewed, to flag a duplicate that comes from another one. */
  source: string;
  /** The other updates of its duplicate group, original first. */
  duplicates: readonly Update[];
  /** Ids of the updates in the current view; only these can be jumped to. */
  listed: ReadonlySet<string>;
  onJump(id: string): void;
  labelOf(source: string): string;
  colorOf(source: string): string | undefined;
}

/**
 * The bottom of the preview: every other update of the same post, with its source, a link to it and,
 * when it is in this view, a button that jumps to it (d). Shown on the original and on its copies alike.
 */
export function DuplicateLinks({ source, duplicates, listed, onJump, labelOf, colorOf }: Props) {
  if (duplicates.length === 0) return null;
  return (
    <section className="detail-pane__duplicates" aria-label="Duplicates">
      <p className="detail-pane__duplicates-label">Duplicates</p>
      <ul className="detail-pane__duplicates-list">
        {duplicates.map((d) => {
          const color = colorOf(d.source);
          return (
            <li key={d.id} className="dup-link">
              <div className="dup-link__head">
                <span className={`dup-link__role dup-link__role--${d.duplicateOf ? 'copy' : 'original'}`}>
                  {d.duplicateOf ? 'duplicate' : 'original'}
                </span>
                <span className="dup-link__source" style={color ? { color } : undefined}>{labelOf(d.source)}</span>
                {d.source !== source && <span className="dup-link__other">other source</span>}
                <span className="dup-link__date">{formatDate(d.datePublished)}</span>
                {listed.has(d.id) ? (
                  <button className="btn dup-link__jump" onClick={() => onJump(d.id)} title="Jump to it in this view (d)">
                    d · Jump
                  </button>
                ) : (
                  <span className="dup-link__hint">not in this view</span>
                )}
              </div>
              <a className="dup-link__title" href={d.url} target="_blank" rel="noreferrer noopener" title={d.title}>
                {d.title}
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
