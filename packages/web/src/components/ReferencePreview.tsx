import React from 'react';
import { formatDate, isManualReferenceUrl, MANUAL_SOURCE_ID, previewText, type Reference, type Update } from '@fomo/core';

export function ReferencePreview({ reference, update, loading, error, onEdit, onClose }: {
  reference: Reference;
  update?: Update;
  loading: boolean;
  error?: string;
  onEdit(): void;
  onClose(): void;
}) {
  const content = update?.source === MANUAL_SOURCE_ID ? update.content : previewText(update?.content ?? '');
  return (
    <div className="detail-pane">
      <p className="detail-pane__title">{reference.title}</p>
      <p className="tree-details__meta">{reference.folder || 'top level'} · filed {formatDate(reference.createdAt)}</p>
      {!isManualReferenceUrl(reference.url) && (
        <a className="detail-pane__url" href={reference.url} target="_blank" rel="noreferrer noopener">{reference.url}</a>
      )}
      <div className="detail-pane__actions">
        <button type="button" className="btn" onClick={onEdit}>e · Edit bookmark</button>
        <button type="button" className="btn" onClick={onClose}>Close preview</button>
      </div>
      <div className="detail-pane__mobile-actions">
        <button type="button" className="btn" onClick={onEdit}>Edit bookmark</button>
        <button type="button" className="btn" onClick={onClose}>Close preview</button>
      </div>
      {reference.description && <p className="tree-details__desc">{reference.description}</p>}
      {error && <p className="tree-error" role="alert">{error}</p>}
      {loading && <p className="detail-pane__no-preview">Loading…</p>}
      {update?.gist && (
        <section className="detail-pane__gist" aria-label="Summary">
          <p className="detail-pane__gist-summary">{update.gist.summary}</p>
          <ul className="detail-pane__gist-points">{update.gist.points.map((point, i) => <li key={i}>{point}</li>)}</ul>
        </section>
      )}
      {content && <pre className="detail-pane__content">{content}</pre>}
      {!loading && !error && !content && !reference.description && !update?.gist && (
        <p className="detail-pane__no-preview">No saved content. Open the link to read it.</p>
      )}
    </div>
  );
}
