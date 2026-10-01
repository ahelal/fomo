import React, { useState } from 'react';
import { parseConnectLink, type SasConnection } from '@fomo/core';

interface Props {
  error?: string;
  onConnect(conn: SasConnection): void;
}

export function ConnectScreen({ error, onConnect }: Props) {
  const [link, setLink] = useState('');
  const [invalid, setInvalid] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const conn = parseConnectLink(link.trim());
    if (!conn) {
      setInvalid(true);
      return;
    }
    onConnect(conn);
  }

  return (
    <div className="connect">
      <div className="connect__panel">
        <h1 className="connect__title">📰 FOMO</h1>
        <p>This device isn't connected yet.</p>
        <p>
          On your computer run <kbd>fomo link</kbd> and scan the QR code or open the link here.
          The access token stays on this device.
        </p>
        {error && <p className="connect__error">{error}</p>}
        <form className="connect__form" onSubmit={submit}>
          <input
            className="connect__input"
            type="url"
            placeholder="…or paste the link"
            value={link}
            onChange={(e) => { setLink(e.target.value); setInvalid(false); }}
            autoComplete="off"
            spellCheck={false}
          />
          <button className="btn btn--primary" type="submit" disabled={!link.trim()}>Connect</button>
        </form>
        {invalid && <p className="connect__error">That doesn't look like a FOMO link.</p>}
      </div>
    </div>
  );
}
