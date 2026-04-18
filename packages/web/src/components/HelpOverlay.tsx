import React from 'react';

interface Props {
  context: 'list' | 'detail' | 'settings';
  onClose(): void;
}

interface Section {
  title: string;
  keys: [string, string][];
}

const LIST_KEYS: [string, string][] = [
  ['↵',     'Open detail view'],
  ['r',     'Mark as read'],
  ['u',     'Mark as unread'],
  ['s',     'Save / unsave'],
  ['x',     'Mark read & next unread'],
  ['n',     'Jump to next unread'],
  ['o',     'Open in browser'],
];

const DETAIL_KEYS: [string, string][] = [
  ['Esc/⌫', 'Close detail view'],
  ['r',     'Mark as read'],
  ['u',     'Mark as unread'],
  ['s',     'Save / unsave'],
  ['x',     'Mark read & next unread'],
  ['n',     'Jump to next unread'],
  ['o',     'Open URL in browser'],
  ['p',     'Fetch full content'],
];

const GLOBAL_KEYS: [string, string][] = [
  ['↑/k',  'Move up'],
  ['↓/j',  'Move down'],
  ['1–4',  'Filter: all / unread / read / saved'],
  ['f',    'Fetch new updates'],
  ['c',    'Open config'],
  ['.',    'Toggle preview position'],
  ['h',    'Show this help'],
];

const SETTINGS_KEYS: [string, string][] = [
  ['Esc/⌫', 'Close config'],
  ['h',     'Show this help'],
];

function buildSections(context: Props['context']): Section[] {
  if (context === 'settings') {
    return [{ title: 'Config', keys: SETTINGS_KEYS }];
  }
  return [
    {
      title: context === 'detail' ? 'Detail View' : 'List View',
      keys: context === 'detail' ? DETAIL_KEYS : LIST_KEYS,
    },
    { title: 'Global', keys: GLOBAL_KEYS },
  ];
}

const CONTEXT_LABEL: Record<string, string> = {
  list: 'Main View',
  detail: 'Detail View',
  settings: 'Config',
};

export function HelpOverlay({ context, onClose }: Props) {
  const sections = buildSections(context);

  return (
    <div className="help-overlay" onClick={onClose}>
      <div className="help-panel" onClick={(e) => e.stopPropagation()}>
        <div className="help-panel__header">
          <h2>⌨ Keyboard Shortcuts</h2>
          <span className="help-panel__context">{CONTEXT_LABEL[context]}</span>
          <button className="btn" onClick={onClose}>✕</button>
        </div>

        {sections.map((section) => (
          <div key={section.title} className="help-panel__section">
            <h3>{section.title}</h3>
            <div className="help-panel__keys">
              {section.keys.map(([key, label]) => (
                <div key={key} className="help-panel__row">
                  <kbd>{key}</kbd>
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </div>
        ))}

        <div className="help-panel__footer">
          Press <kbd>Esc</kbd> or <kbd>⌫</kbd> to close
        </div>
      </div>
    </div>
  );
}
