import React from 'react';
import type { StatsResponse } from '@fomo/core';

interface Props {
  stats: StatsResponse | undefined;
  loading: boolean;
  message: string | undefined;
  /** Days until the access link expires. */
  expiresInDays?: number;
  onDisconnect(): void;
  onHelpClick(): void;
  onSettingsClick(): void;
}

export function StatusBar({ stats, loading, message, expiresInDays, onDisconnect, onHelpClick, onSettingsClick }: Props) {
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

      {loading && <span className="statusbar__loading">⟳</span>}
      {message && <span className="statusbar__message">{message}</span>}

      {expiresInDays !== undefined && expiresInDays <= 14 && (
        <span className="statusbar__warning" title="Create a new link in fomo: press c → Link a device">
          ⚠ link expires {expiresInDays <= 0 ? 'today' : `in ${expiresInDays}d`}
        </span>
      )}

      <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className="btn" onClick={onSettingsClick}>⚙️</button>
        <button className="btn btn--primary" onClick={onHelpClick}>
          [h] help
        </button>
        <button className="btn" onClick={onDisconnect} title="Forget the access link on this device">
          Disconnect
        </button>
      </div>
    </div>
  );
}
