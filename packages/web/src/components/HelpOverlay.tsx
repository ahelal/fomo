import React from 'react';

export type HelpContext = 'list' | 'detail' | 'settings' | 'digest' | 'saved' | 'references' | 'todos';

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
  ['p',     'Mark pending / not pending'],
  ['d',     'Jump to the duplicate / original, if it is in this view'],
  ['s',     'Cycle sort order (topics)'],
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
  ['p',     'No longer pending'],
  ['d',     'Jump to the duplicate / original, if it is in this view'],
  ['s',     'Cycle sort order (topics)'],
  ['o',     'Open in browser (newest in topic)'],
  ['Esc/⌫', 'Close detail'],
];

const LIST_KEYS: [string, string][] = [
  ['↵',     'Open detail view'],
  ['r',     'Toggle read / unread'],
  ['p',     'Mark pending / not pending'],
  ['d',     'Jump to the duplicate / original, if it is in this view'],
  ['s',     'Cycle sort order (date, source, title…)'],
  ['x',     'Mark read & next unread'],
  ['n',     'Jump to next unread'],
  ['o',     'Open in browser'],
];

const DETAIL_KEYS: [string, string][] = [
  ['Esc/⌫', 'Close detail view'],
  ['r',     'Toggle read / unread'],
  ['p',     'Mark pending / not pending'],
  ['d',     'Jump to the duplicate / original, if it is in this view'],
  ['x',     'Mark read & next unread'],
  ['n',     'Jump to next unread'],
  ['o',     'Open URL in browser'],
];

const REFERENCE_KEYS: [string, string][] = [
  ['↵',     'Open folder / open link'],
  ['→/l',   'Open folder'],
  ['←',     'Close folder, or go to its parent'],
  ['a',     'Add a link (in the selected folder)'],
  ['e',     'Edit link / rename or move folder'],
  ['d d',   'Delete link (press twice)'],
  ['o',     'Open link in browser'],
  ['y',     'Copy link'],
  ['c',     'Color the link or folder (←↑↓→ ↵ pick, # hex, d reset)'],
  ['s',     'Cycle sort order (title, date added)'],
  ['/',     'Search titles, links, folders & descriptions'],
  ['Esc',   'Clear the search'],
  ['5',     'Back to the previous view'],
];

const TODO_KEYS: [string, string][] = [
  ['a',     'Add a todo (in the selected folder)'],
  ['↵',     'Next status (pending → in progress → done) / open folder'],
  ['x',     'Done, or reopen a done todo'],
  ['e',     'Edit todo / rename or move folder'],
  ['c',     'Color the todo or folder (←↑↓→ ↵ pick, # hex, d reset)'],
  ['d d',   'Delete todo (press twice)'],
  ['→/l',   'Open folder'],
  ['←',     'Close folder, or go to its parent'],
  ['v',     'Show all / open / in progress / done'],
  ['s',     'Cycle sort order (status, due, created, subject)'],
  ['/',     'Search subjects, descriptions & folders'],
  ['Esc',   'Clear the search'],
  ['6',     'Back to the previous view'],
];

const GLOBAL_KEYS: [string, string][] = [
  ['↑/k',  'Move up'],
  ['↓/j',  'Move down'],
  ['⇧↑/⇧↓','Jump 5 rows (10 on a tall window)'],
  ['1–4',  'All / unread / read / pending'],
  ['⇥/⇧⇥', 'Next / previous view (1–6)'],
  ['2 / 4','Again: switch Unread / Pending between topics and a list'],
  ['5',    'Bookmarks: links filed into folders'],
  ['6',    'Todos: tasks filed into folders'],
  ['b',    'File the selected update in Bookmarks'],
  ['/',    'Search titles & content in this view (↵ search)'],
  ['v',    'Pick which sources to show (works with the search)'],
  ['Esc',  'Clear the search, then the source filter'],
  ['c',    'Open config (Bookmarks / Todos: color)'],
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
  if (context === 'references') {
    return [{ title: 'Bookmarks', keys: REFERENCE_KEYS }, { title: 'Global', keys: GLOBAL_KEYS }];
  }
  if (context === 'todos') {
    return [{ title: 'Todos', keys: TODO_KEYS }, { title: 'Global', keys: GLOBAL_KEYS }];
  }
  if (context === 'saved') {
    return [{ title: 'Pending topics', keys: SAVED_KEYS }, { title: 'Global', keys: GLOBAL_KEYS }];
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
  references: 'Bookmarks',
  todos: 'Todos',
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
          Press <kbd>Esc</kbd> or <kbd>⌫</kbd> to close · letter keys work in either case
        </div>
      </div>
    </div>
  );
}
