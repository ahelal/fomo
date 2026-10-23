import React from 'react';
import { Box, Text } from 'ink';
import { searchTerms } from '@fomo/core';
import { VERSION } from '../../version.js';

export type HelpContext = 'list' | 'detail' | 'settings' | 'digest' | 'saved' | 'references' | 'todos';

interface Props {
  context: HelpContext;
  height: number;
  columns: number;
  /** `/` filter of the keys. */
  search?: string;
  /** The filter is being typed. */
  searchTyping?: boolean;
}

interface Section {
  title: string;
  keys: [string, string][];
}

const DIGEST_KEYS: [string, string][] = [
  ['↵',    'Expand topic / toggle detail'],
  ['→/l',  'Expand topic'],
  ['←',    'Collapse topic'],
  ['r',    'Toggle topic (or update) read / unread'],
  ['x',    'Mark read & next unread'],
  ['n',    'Jump to next topic'],
  ['p',    'Mark update pending / not pending'],
  ['s',    'Sort: importance, date, title, size (press again for the next)'],
  ['g',    'Summarise update with Copilot (g again: regenerate)'],
  ['u',    'Refresh update from its page: reading time, video length, preview'],
  ['o',    'Open in browser (newest in topic)'],
  ['Esc/⌫','Close detail'],
  ['q',    'Quit'],
];

const SAVED_KEYS: [string, string][] = [
  ['↵',    'Expand topic / toggle detail'],
  ['→/l',  'Expand topic'],
  ['←',    'Collapse topic'],
  ['r',    'Toggle topic (or update) read / unread'],
  ['x',    'Mark read & next'],
  ['n',    'Jump to next topic'],
  ['p',    'Remove update from Pending'],
  ['s',    'Sort: importance, date, title, size (press again for the next)'],
  ['g',    'Summarise update with Copilot (g again: regenerate)'],
  ['u',    'Refresh update from its page: reading time, video length, preview'],
  ['o',    'Open in browser (newest in topic)'],
  ['Esc/⌫','Close detail'],
  ['q',    'Quit'],
];

const LIST_KEYS: [string, string][] = [
  ['↵',    'Open detail view'],
  ['r',    'Toggle read / unread'],
  ['p',    'Mark pending / not pending'],
  ['s',    'Sort: date, source, title, status (press again for the next)'],
  ['g',    'Summarise with Copilot (saved; g again: regenerate)'],
  ['u',    'Refresh from the page: reading time, video length, preview'],
  ['x',    'Mark read & next unread'],
  ['n',    'Jump to next unread'],
  ['o',    'Open in browser'],
  ['q',    'Quit'],
];

const DETAIL_KEYS: [string, string][] = [
  ['Esc/⌫', 'Close detail view'],
  ['r',     'Toggle read / unread'],
  ['p',     'Mark pending / not pending'],
  ['g',     'Summarise with Copilot (saved; g again: regenerate)'],
  ['u',     'Refresh from the page: reading time, video length, preview'],
  ['x',     'Mark read & next unread'],
  ['n',     'Jump to next unread'],
  ['o',     'Open URL in browser'],
];

const GLOBAL_KEYS: [string, string][] = [
  ['↑/k',  'Move up'],
  ['↓/j',  'Move down'],
  ['⇧↑/⇧↓','Jump 5 rows (10 on a tall terminal)'],
  ['1–4',  'All / unread / read / pending'],
  ['⇥/⇧⇥', 'Next / previous view (1–6)'],
  ['2 / 4','Again: switch between ▤ topics and ≡ list'],
  ['f',    'Fetch latest updates + group with Copilot'],
  ['z',    'Regroup all topics with Copilot (press twice)'],
  ['c',    'Config: sources, link a device, backup / restore'],
  ['w',    'Switch profile (storage account): ↵ switch, a add, e rename, x remove'],
  ['5',    'Bookmarks: links filed into folders'],
  ['6',    'Todos: tasks filed into folders'],
  ['b',    'File the selected update in Bookmarks (Copilot suggests folder + note)'],
  ['d',    'Jump to the duplicate / original of the update, if it is in this view'],
  ['/',    'Search titles & content in this view (↵ search)'],
  ['v',    'Pick which sources to show (works with the search)'],
  ['Esc',  'Clear the search, then the source filter'],
  ['.',    'Show preview / toggle its position'],
  ['a',    'Audit trail: every action and error (e: errors only)'],
  ['h',    'Show this help'],
];

const REFERENCE_KEYS: [string, string][] = [
  ['↑/k ↓/j', 'Move (⇧↑/⇧↓ jumps 5, or 10 on a tall terminal)'],
  ['↵',    'Open / close folder · open link in browser'],
  ['→/l ←','Open folder · close folder / go to parent'],
  ['o',    'Open link in browser'],
  ['y',    'Copy link'],
  ['a',    'Add a link (in the selected folder)'],
  ['e',    'Edit link · rename or move folder (with its subfolders)'],
  ['c',    'Color link or folder (links take their folder’s): ←↑↓→ ↵ pick, # hex, d reset'],
  ['d',    'Delete link (press twice)'],
  ['/',    'Search titles, links, folders & notes'],
  ['s',    'Sort links: title, date added (press again for the next)'],
  ['Esc',  'Clear the search'],
];

const REFERENCE_FORM_KEYS: [string, string][] = [
  ['Tab/↑↓','Next field (Shift+Tab: previous)'],
  ['↑↓',   'In Folder: pick an existing folder'],
  ['^G',   'Ask Copilot for folder, note (and title)'],
  ['^U',   'Clear field'],
  ['↵',    'Save (in Color: pick a color)'],
  ['Esc',  'Cancel'],
];

const TODO_KEYS: [string, string][] = [
  ['↑/k ↓/j', 'Move (⇧↑/⇧↓ jumps 5, or 10 on a tall terminal)'],
  ['↵',    'Open / close folder · todo status: pending → in progress → done'],
  ['→/l ←','Open folder · close folder / go to parent'],
  ['x',    'Mark done / reopen'],
  ['a',    'Add a todo (in the selected folder)'],
  ['e',    'Edit todo · rename or move folder (with its subfolders)'],
  ['o',    'Attachments: ↑↓ select, ↵ open a URL or local file, Esc back'],
  ['c',    'Color todo or folder (todos take their folder’s): ←↑↓→ ↵ pick, # hex, d reset'],
  ['d',    'Delete todo (press twice)'],
  ['v',    'Show all, open, in progress or done todos (press again for the next)'],
  ['/',    'Search subjects, notes, folders & attachments'],
  ['s',    'Sort: status, due date, newest, subject (press again for the next)'],
  ['Esc',  'Clear the search'],
];

const TODO_FORM_KEYS: [string, string][] = [
  ['Tab',  'Next field (Shift+Tab: previous); in Attachments, completes a file path first'],
  ['←↑↓→', 'Move the cursor in Notes and Attachments'],
  ['↑↓',   'In Folder: pick an existing folder'],
  ['Due',  '2026-03-06, today, tomorrow, mon…sun, +3 (days), 2w (weeks)'],
  ['^U',   'Clear field'],
  ['↵',    'New line in Notes/Attachments; otherwise save (Color: pick)'],
  ['^S',   'Save from any field'],
  ['Files','One URL or filesystem path per attachment line; no uploads'],
  ['Esc',  'Cancel'],
];

const SETTINGS_KEYS: [string, string][] = [
  ['↑/k',  'Move up'],
  ['↓/j',  'Move down'],
  ['⇧↑/⇧↓', 'Jump 5 rows (10 on a tall screen)'],
  ['PgUp/Dn', 'Scroll a page'],
  ['↵',    'Run action / open source details / edit setting / fold section'],
  ['space','Turn a source on or off'],
  ['←/→',  'Collapse / expand a section'],
  ['e',    'Edit source label or setting'],
  ['d',    'Pick source color: ←↑↓→ ↵ pick, # hex, d default'],
  ['f',    'Fetch this source now'],
  ['v',    'Show only this source’s updates'],
  ['x',    'Remove this source: x again keeps its items, d deletes them too'],
  ['s',    'In source details: save the changes'],
  ['d',    'In source details: delete its stored items (d again to confirm)'],
  ['↵',    'On “Add source”: add an RSS/Atom feed, GitHub repo or YouTube channel'],
  ['↵',    'On an experimental source: turn it on (↵ again to sign in) or off'],
  ['l',    'On an experimental source: sign in again'],
  ['o',    'Open the web app in the browser (web app rows)'],
  ['/',    'Search rows (a matching section header keeps its rows)'],
  ['Esc/⌫','Cancel / close config'],
  ['h',    'Show this help'],
];

function buildSections(context: Props['context']): Section[] {
  if (context === 'settings') {
    return [{ title: 'Config', keys: SETTINGS_KEYS }];
  }
  if (context === 'references') {
    return [
      { title: 'Bookmarks', keys: REFERENCE_KEYS },
      { title: 'Add / edit form', keys: REFERENCE_FORM_KEYS },
    ];
  }
  if (context === 'todos') {
    return [
      { title: 'Todos', keys: TODO_KEYS },
      { title: 'Add / edit form', keys: TODO_FORM_KEYS },
    ];
  }
  if (context === 'digest') {
    return [{ title: 'Unread topics', keys: DIGEST_KEYS }, { title: 'Global', keys: GLOBAL_KEYS }];
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
  saved: 'Pending · topics',
  references: 'Bookmarks',
  todos: 'Todos',
};

const KEY_W = 8;

/** Sections with only the keys matching every word of `search` (all keys of a matching section title). */
export function filterHelp(sections: Section[], search: string): Section[] {
  const terms = searchTerms(search);
  if (terms.length === 0) return sections;
  const has = (text: string) => terms.every((t) => text.toLowerCase().includes(t));
  return sections
    .map((s) => (has(s.title) ? s : { ...s, keys: s.keys.filter(([key, label]) => has(`${key} ${label}`)) }))
    .filter((s) => s.keys.length > 0);
}

export function HelpOverlay({ context, height, columns, search = '', searchTyping = false }: Props) {
  const sections = filterHelp(buildSections(context), search);

  return (
    <Box flexDirection="column" height={height} width={columns}>
      {/* Header */}
      <Box justifyContent="center" paddingTop={1}>
        <Text color="#f0f6fc" bold>{'⌨  Keyboard Shortcuts'}</Text>
      </Box>
      <Box justifyContent="center">
        <Text color="#8b949e">{`${CONTEXT_LABEL[context]} · FOMO v${VERSION}`}</Text>
      </Box>
      <Box justifyContent="center">
        {searchTyping ? (
          <Text color="#e3b341">{`/${search}▏   ↵ keep   Esc clear`}</Text>
        ) : search ? (
          <Text color="#e3b341">{`/ ${search}${sections.length ? '' : ' — no matches'}   Esc clear`}</Text>
        ) : (
          <Text color="#8b949e">{'/ search'}</Text>
        )}
      </Box>
      <Box height={1} />

      {/* Sections */}
      {sections.map((section) => (
        <React.Fragment key={section.title}>
          <Box paddingX={4}>
            <Text color="#58a6ff" bold>{section.title}</Text>
          </Box>
          {section.keys.map(([key, label]) => (
            <Box key={key} paddingX={6}>
              <Text color="#58a6ff" bold>{key.padEnd(KEY_W)}</Text>
              <Text color="#c9d1d9">{label}</Text>
            </Box>
          ))}
          <Box height={1} />
        </React.Fragment>
      ))}

      {/* Footer */}
      <Box justifyContent="center">
        <Text color="#8b949e">
          {'Press '}
          <Text color="#58a6ff" bold>Esc</Text>
          {' or '}
          <Text color="#58a6ff" bold>⌫</Text>
          {' to close · letter keys work in either case'}
        </Text>
      </Box>
    </Box>
  );
}
