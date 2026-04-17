import React from 'react';
import type { StatsResponse } from '@fomo/core';

interface Props {
  stats: StatsResponse | undefined;
  loading: boolean;
  message: string | undefined;
  filter: string;
  userEmail?: string;
  onLogout(): void;
  onFetchClick(): void;
}

export function StatusBar({ stats, loading, message, filter, userEmail, onLogout, onFetchClick }: Props) {
  return (
    <div className="statusbar">
      <span className="statusbar__brand">📰 FOMO</span>
      <span className="statusbar__sep">│</span>

      {stats ? (
        <div className="statusbar__counts">
          <span className="statusbar__count">
            Total: <span>{stats.total}</span>
          </span>
          <span className="statusbar__count">
            Unread: <span>{stats.byStatus.unread ?? 0}</span>
          </span>
          <span className="statusbar__count">
            Read: <span>{stats.byStatus.read ?? 0}</span>
          </span>
          <span className="statusbar__count statusbar__count--saved">
            Saved: <span>{stats.saved ?? 0}</span>
          </span>
        </div>
      ) : (
        <span className="statusbar__count">loading…</span>
      )}

      <span className="statusbar__sep">│</span>
      <span className="statusbar__filter">
        Filter: <strong>{filter.toUpperCase()}</strong>
      </span>

      {loading && <span className="statusbar__loading">⟳</span>}
      {message && <span className="statusbar__message">{message}</span>}

      <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className="btn btn--primary" onClick={onFetchClick} disabled={loading}>
          ↻ Fetch
        </button>
        {userEmail && (
          <>
            <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>{userEmail}</span>
            <button className="btn" onClick={onLogout}>Logout</button>
          </>
        )}
      </div>
    </div>
  );
}
