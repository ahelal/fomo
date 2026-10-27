import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FomoService, Reference, Todo } from '@fomo/core';
import { TodoDialog } from './TodoDialog.js';
import { TodoDetails } from './TodosPane.js';
import { ReferenceDialog } from './ReferenceDialog.js';
import { TodoAttachments } from './TodoAttachments.js';
import { DeleteFolderDialog, FolderDialog } from './FolderDialog.js';

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const service = {} as FomoService;
const FOLDER_COLORS = { work: '#f85149' };

const TODO: Todo = {
  id: 't1',
  subject: 'Ship folders',
  description: '',
  dueDate: '2026-03-02',
  status: 'in_progress',
  folder: 'work/fomo',
  createdAt: '2026-03-01T00:00:00Z',
  updatedAt: '2026-03-01T00:00:00Z',
};

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(2026, 2, 4, 12) });
});
afterEach(() => {
  vi.useRealTimers();
});

function renderTodoDialog(props: Partial<React.ComponentProps<typeof TodoDialog>> = {}) {
  return renderToStaticMarkup(
    <TodoDialog service={service} folders={['work', 'work/fomo']} folderColors={FOLDER_COLORS} onSaved={vi.fn()} onClose={vi.fn()} {...props} />,
  );
}

describe('TodoDialog', () => {
  it('adds a todo in the folder it was opened in, showing that folder’s color', () => {
    const html = renderTodoDialog({ initial: { folder: 'work' } });
    expect(text(html)).toContain('✓ Add a todo');
    expect(html).toContain('value="work"');
    expect(html).toContain('<svg class="tree-icon" viewBox="0 0 16 16" aria-hidden="true" style="color:#f85149">');
    // No color of its own: it shows the folder's.
    expect(text(html)).toContain('folder color');
    expect(html).toContain('border-color:#f85149');
  });

  it('adds an idea without exposing a due-date field', () => {
    const html = renderTodoDialog({ initial: { kind: 'idea', folder: 'work' } });
    expect(text(html)).toContain('✓ Add an idea');
    expect(html).toContain('<option value="idea" selected="">Idea</option>');
    expect(text(html)).not.toContain('Due');
    expect(html).not.toContain('type="date"');
  });

  it('reads a typed due date and fills the date picker with it', () => {
    const html = renderTodoDialog({ initial: { due: 'fri' } });
    expect(text(html)).toContain('→ 2026-03-06 · in 2d');
    expect(html).toContain('type="date" aria-label="Pick the due date" value="2026-03-06"');
  });

  it('flags a due date it can’t read', () => {
    const html = renderTodoDialog({ initial: { due: 'someday' } });
    expect(html).toContain('item-dialog__due-hint--error');
    expect(text(html)).toContain('not a date');
    expect(html).toContain('type="date" aria-label="Pick the due date" value=""');
  });

  it('edits a todo with what it has', () => {
    const html = renderTodoDialog({ todo: { ...TODO, color: '#3fb950', description: 'In both apps' } });
    expect(text(html)).toContain('✓ Edit todo');
    expect(html).toContain('value="Ship folders"');
    expect(html).toContain('value="2026-03-02"');
    expect(html).toContain('In both apps</textarea>');
    expect(html).toContain('background-color:#3fb950');
  });

  it('edits multiline notes and URL/path references without flattening their lines', () => {
    const html = renderTodoDialog({ todo: { ...TODO, description: 'First line\n\n  Second line', attachments: ['https://example.com/report', '~/Documents/a file.pdf'] } });
    expect(html).toContain('First line\n\n  Second line</textarea>');
    expect(html).toContain('https://example.com/report\n~/Documents/a file.pdf</textarea>');
    expect(text(html)).toContain('Notes (optional)');
    expect(text(html)).toContain('files are not uploaded');
    expect(text(html)).toContain('Ctrl/Cmd+S');
    expect(html).not.toContain('type="file"');
  });
});

describe('TodoDetails', () => {
  it('shows the status, an overdue date in red and the folder', () => {
    const html = renderToStaticMarkup(<TodoDetails todo={TODO} color="#f85149" />);
    expect(html).toContain('<p class="tree-details__title" style="color:#f85149">Ship folders</p>');
    expect(text(html)).toContain('◑ In progress');
    expect(html).toContain('<span class="todo-due--overdue">due 26-03-02 (2d overdue)</span>');
    expect(text(html)).toContain('work/fomo/');
    expect(text(html)).toContain('No notes — e to add them.');
  });

  it('never calls a done todo overdue', () => {
    const html = renderToStaticMarkup(<TodoDetails todo={{ ...TODO, status: 'done', folder: '' }} />);
    expect(html).toContain('todo-due--later');
    expect(text(html)).toContain('top level');
  });

  it('shows an idea as a distinct kind without a task status or due date', () => {
    const html = renderToStaticMarkup(<TodoDetails todo={{ ...TODO, kind: 'idea' }} />);
    expect(text(html)).toContain('✧ Idea');
    expect(text(html)).not.toContain('In progress');
    expect(text(html)).not.toContain('due 26-03-02');
    expect(html).not.toContain('todo-due--');
  });

  it('renders notes as plain text with their line breaks intact', () => {
    const html = renderToStaticMarkup(<TodoDetails todo={{ ...TODO, description: 'First line\n<script>alert(1)</script>\nLast line' }} />);
    expect(html).toContain('First line\n&lt;script&gt;alert(1)&lt;/script&gt;\nLast line');
    expect(html).not.toContain('<script>');
  });
});

describe('TodoAttachments', () => {
  it('opens web URLs in new tabs but offers copy actions for paths, not file links', () => {
    const html = renderToStaticMarkup(
      <TodoAttachments todo={{ ...TODO, attachments: ['https://example.com/report', '~/Documents/a file.pdf', 'file:///tmp/report.pdf'] }} onClose={vi.fn()} />,
    );
    expect(html).toContain('href="https://example.com/report" target="_blank" rel="noopener noreferrer"');
    expect(html).toContain('aria-label="Copy path ~/Documents/a file.pdf"');
    expect(html).toContain('aria-label="Copy path file:///tmp/report.pdf"');
    expect(html).not.toContain('href="file:');
    expect(html).not.toContain('href="~/');
  });
});

describe('ReferenceDialog', () => {
  const ref: Reference = {
    id: 'r1',
    title: 'FOMO',
    url: 'https://example.com',
    description: '',
    folder: 'work',
    createdAt: '2026-03-01T00:00:00Z',
    updatedAt: '2026-03-01T00:00:00Z',
  };

  it('shows a link’s own color, and its folder’s when it has none', () => {
    const own = renderToStaticMarkup(
      <ReferenceDialog service={service} reference={{ ...ref, color: '#3fb950' }} folders={['work']} folderColors={FOLDER_COLORS} onSaved={vi.fn()} onClose={vi.fn()} />,
    );
    expect(text(own)).toContain('Edit bookmark');
    expect(own).toContain('background-color:#3fb950');
    const none = renderToStaticMarkup(
      <ReferenceDialog service={service} reference={ref} folders={['work']} folderColors={FOLDER_COLORS} onSaved={vi.fn()} onClose={vi.fn()} />,
    );
    expect(text(none)).toContain('folder color');
    expect(none).toContain('border-color:#f85149');
  });
});

describe('FolderDialog', () => {
  it('edits the folder name, local directory, GitHub repo and color without a type', () => {
    const html = renderToStaticMarkup(
      <FolderDialog
        moveFolder={(from, to) => service.moveTodoFolder(from, to)}
        saveMetadata={(path, metadata) => service.setTodoFolderMetadata(path, metadata)}
        saveColor={(path, color) => service.setTodoFolderColor(path, color)}
        path="work"
        metadata={{ localPath: '/src/work', githubRepo: 'octo/work' }}
        folders={['work']}
        folderColors={FOLDER_COLORS}
        onSaved={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(text(html)).toContain('✓ Edit folder work/');
    expect(text(html)).toContain('Local directory');
    expect(text(html)).toContain('GitHub repository');
    expect(text(html)).toContain('Color');
    expect(text(html)).not.toContain('Type');
    expect(html).not.toContain('<select');
    expect(html).toContain('background-color:#f85149');
    expect(html).toContain('value="work"');
    expect(html).toContain('value="/src/work"');
    expect(html).toContain('value="octo/work"');
  });

  it('shows the parent color for a folder with no color of its own', () => {
    const html = renderToStaticMarkup(
      <FolderDialog moveFolder={(from, to) => service.moveReferenceFolder(from, to)}
        saveMetadata={(path, metadata) => service.setReferenceFolderMetadata(path, metadata)}
        saveColor={(path, color) => service.setReferenceFolderColor(path, color)}
        path="work/fomo" folders={['work', 'work/fomo']}
        folderColors={FOLDER_COLORS} onSaved={vi.fn()} onClose={vi.fn()} />,
    );
    expect(text(html)).toContain('parent folder');
    expect(html).toContain('border-color:#f85149');
  });
});

describe('DeleteFolderDialog', () => {
  it('offers moving the contents to the parent or deleting everything', () => {
    const html = renderToStaticMarkup(
      <DeleteFolderDialog prompt={{ path: 'work/fomo', count: 3, subfolders: 1 }} noun={['todo', 'todos']} onDelete={vi.fn()} onClose={vi.fn()} />,
    );
    expect(text(html)).toContain('Delete work/fomo/');
    expect(text(html)).toContain('It holds 3 todos and 1 subfolder');
    expect(text(html)).toContain('p · Move contents to work/');
    expect(text(html)).toContain('a · Delete all');
  });

  it('moves a top-level folder’s contents to the top level and shows a refusal', () => {
    const html = renderToStaticMarkup(
      <DeleteFolderDialog prompt={{ path: 'ai', count: 1, subfolders: 0, error: 'Conflicting metadata for agents/' }} noun={['link', 'links']} onDelete={vi.fn()} onClose={vi.fn()} />,
    );
    expect(text(html)).toContain('It holds 1 link.');
    expect(text(html)).toContain('Move contents to the top level');
    expect(text(html)).toContain('⚠ Conflicting metadata for agents/');
  });
});
