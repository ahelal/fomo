import React from 'react';

export type HelpContext = 'list' | 'detail' | 'settings' | 'digest' | 'saved';

interface Props {
  context: HelpContext;
  onClose(): void;
}

interface Section {
  title: string;
  keys: [string, string][];
}

const DIGEST_KEYS: [string, string][] = [
  ['↵',     'Expand / collapse topic'],
  ['→/l',   'Expand topic'],
  ['←',     'Collapse topic'],
  ['r',     'Toggle topic (or update) read / unread'],
  ['x',     'Mark read & next unread'],
  ['n',     'Jump to next topic'],
  ['s',     'Save / unsave update'],
  ['o',     'Open in browser (newest in topic)'],
  ['Esc/⌫', 'Close detail'],
];

const SAVED_KEYS: [string, string][] = [
  ['↵',     'Expand / collapse topic'],
  ['→/l',   'Expand topic'],
  ['←',     'Collapse topic'],
  ['r',     'Toggle topic (or update) read / unread'],
  ['x',     'Mark read & next'],
  ['n',     'Jump to next topic'],
  ['s',     'Unsave update'],
  ['o',     'Open in browser (newest in topic)'],
  ['Esc/⌫', 'Close detail'],
];

const LIST_KEYS: [string, string][] = [
  ['↵',     'Open detail view'],
  ['r',     'Toggle read / unread'],
  ['s',     'Save / unsave'],
  ['x',     'Mark read & next unread'],
  ['n',     'Jump to next unread'],
  ['o',     'Open in browser'],
];

const DETAIL_KEYS: [string, string][] = [
  ['Esc/⌫', 'Close detail view'],
  ['r',     'Toggle read / unread'],
  ['s',     'Save / unsave'],
  ['x',     'Mark read & next unread'],
  ['n',     'Jump to next unread'],
  ['o',     'Open URL in browser'],
];

const GLOBAL_KEYS: [string, string][] = [
  ['↑/k',  'Move up'],
  ['↓/j',  'Move down'],
  ['1–4',  'All / unread / read / saved'],
  ['2 / 4','Again: switch Unread / Saved between topics and a list'],
  ['5/t',  'Todos'],
  ['/',    'Search titles & content in this view (↵ search)'],
  ['v',    'Pick which sources to show (works with the search)'],
  ['Esc',  'Clear the search, then the source filter'],
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
  if (context === 'digest') {
    return [{ title: 'Unread topics', keys: DIGEST_KEYS }, { title: 'Global', keys: GLOBAL_KEYS }];
  }
  if (context === 'saved') {
    return [{ title: 'Saved topics', keys: SAVED_KEYS }, { title: 'Global', keys: GLOBAL_KEYS }];
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
  digest: 'Unread · topics',
  saved: 'Saved · topics',
};

export function HelpOverlay({ context, onClose }: Props) {
  const sections = buildSections(context);

  return (
    <div className="help-overlay" onClick={onClose}>
      <div className="help-panel" onClick={(e) => e.stopPropagation()}>
        <div className="help-panel__header">
          <h2>⌨ Keyboard Shortcuts</h2>
          <span className="help-panel__context">{CONTEXT_LABEL[context]} · FOMO v{__FOMO_VERSION__}</span>
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
