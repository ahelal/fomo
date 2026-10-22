import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { buildTodoRows, type Todo } from '@fomo/core';
import { FolderDetails, FolderTreeList, Progress, RenameBar, TreeMessage } from './FolderTree.js';

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const todo = (id: string, folder: string, status: Todo['status'] = 'pending'): Todo => ({
  id,
  subject: `Task ${id}`,
  description: '',
  status,
  folder,
  createdAt: '2026-03-01T00:00:00Z',
  updatedAt: '2026-03-01T00:00:00Z',
});

const TODOS = [todo('1', 'work/fomo', 'done'), todo('2', 'work/fomo'), todo('3', 'work'), todo('4', '')];
const FOLDER_COLORS: Record<string, string> = { work: '#f85149' };

function renderTree(props: Partial<React.ComponentProps<typeof FolderTreeList<Todo>>> = {}) {
  const rows = buildTodoRows(TODOS, new Set(['work', 'work/fomo']));
  return renderToStaticMarkup(
    <FolderTreeList<Todo>
      label="Todos"
      rows={rows}
      index={0}
      folderColorOf={(path) => (path.startsWith('work') ? FOLDER_COLORS.work! : '#e3b341')}
      onSelect={vi.fn()}
      onToggle={vi.fn()}
      renderItem={(t) => <span className="subject">{t.subject}</span>}
      {...props}
    />,
  );
}

describe('FolderTreeList', () => {
  it('lists folders first, then their items, indented by depth', () => {
    const html = renderTree();
    expect(text(html)).toBe('▾ work/ 3 ▾ fomo/ 2 Task 2 Task 1 Task 3 Task 4');
    expect(html).toContain('role="tree" aria-label="Todos"');
    expect(html.match(/aria-level="(\d)"/g)).toEqual([
      'aria-level="1"', 'aria-level="2"', 'aria-level="3"', 'aria-level="3"', 'aria-level="2"', 'aria-level="1"',
    ]);
    expect(html).toContain('padding-left:44px');
  });

  it('shows folders in their color, open or closed, and marks the selected row', () => {
    const html = renderTree({ index: 1 });
    expect(html).toContain('<span class="tree-row__folder" style="color:#f85149">work/</span>');
    expect(html).toContain('aria-expanded="true"');
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(html).toMatch(/tree-row--selected" style="padding-left:26px" aria-expanded="true"/);
  });

  it('shows how many of a folder’s todos are done instead of a count', () => {
    const html = renderTree({ progress: true });
    expect(html).toContain('aria-label="1 of 3 done"');
    expect(html).toContain('aria-label="1 of 2 done"');
    expect(text(html)).toContain('work/ 1/3');
  });

  it('says why it is empty', () => {
    const html = renderTree({ rows: [], empty: 'No todos yet. Press a to add one.' });
    expect(html).toContain('<li class="tree-empty" role="none">No todos yet. Press a to add one.</li>');
    expect(html).not.toContain('role="treeitem"');
  });
});

describe('Progress', () => {
  it('fills the bar by how much is done', () => {
    const html = renderToStaticMarkup(<Progress done={1} count={4} />);
    expect(html).toContain('width:25%');
    expect(html).toContain('aria-valuenow="1"');
    expect(html).not.toContain('tree-progress--complete');
  });

  it('turns green when everything is done', () => {
    expect(renderToStaticMarkup(<Progress done={2} count={2} />)).toContain('tree-progress--complete');
    expect(renderToStaticMarkup(<Progress done={0} count={0} />)).toContain('width:0%');
  });

  it('can say it in words instead', () => {
    const html = renderToStaticMarkup(<Progress done={1} count={2} label="1 of 2 todos done" />);
    expect(text(html)).toBe('1 of 2 todos done');
  });
});

describe('TreeMessage', () => {
  it('keeps its line when empty, and shows the tone of a message', () => {
    expect(renderToStaticMarkup(<TreeMessage />)).toBe('<p class="tree-message" role="status"></p>');
    const html = renderToStaticMarkup(<TreeMessage status={{ text: 'd again to delete “x”', tone: 'warn' }} />);
    expect(html).toContain('tree-message--warn');
    expect(html).toContain('d again to delete “x”');
  });
});

describe('RenameBar', () => {
  it('suggests the folders and shows why a move failed', () => {
    const html = renderToStaticMarkup(
      <RenameBar
        rename={{ from: 'work', value: 'work/fomo', error: 'Folders nest at most 6 deep' }}
        folders={['play', 'work']}
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(text(html)).toContain('Move work/ to');
    expect(html).toContain('value="work/fomo"');
    expect(html).toContain('<option value="play">');
    expect(text(html)).toContain('⚠ Folders nest at most 6 deep');
  });
});

describe('FolderDetails', () => {
  it('shows the folder in its color, and a color button with what it shows without one', () => {
    const html = renderToStaticMarkup(
      <FolderDetails
        path="work/fomo"
        color="#f85149"
        colorButton={{ color: '', fallback: '#f85149', fallbackLabel: 'parent folder' }}
        meta="2 todos"
        onColor={vi.fn()}
      >
        <button type="button">a · Add todo here</button>
      </FolderDetails>,
    );
    expect(html).toContain('<p class="tree-details__title" style="color:#f85149">');
    expect(text(html)).toContain('work/fomo/');
    expect(text(html)).toContain('a · Add todo here');
    expect(html).toContain('color-button__chip--none');
    expect(html).toContain('border-color:#f85149');
    expect(text(html)).toContain('parent folder');
  });
});
