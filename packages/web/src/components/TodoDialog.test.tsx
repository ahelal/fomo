import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FomoService, Reference, Todo } from '@fomo/core';
import { TodoDialog } from './TodoDialog.js';
import { TodoDetails } from './TodosPane.js';
import { ReferenceDialog } from './ReferenceDialog.js';

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
});

describe('TodoDetails', () => {
  it('shows the status, an overdue date in red and the folder', () => {
    const html = renderToStaticMarkup(<TodoDetails todo={TODO} color="#f85149" />);
    expect(html).toContain('<p class="tree-details__title" style="color:#f85149">Ship folders</p>');
    expect(text(html)).toContain('◑ In progress');
    expect(html).toContain('<span class="todo-due--overdue">due 2026-03-02 (2d overdue)</span>');
    expect(text(html)).toContain('work/fomo/');
    expect(text(html)).toContain('No description — e to add one.');
  });

  it('never calls a done todo overdue', () => {
    const html = renderToStaticMarkup(<TodoDetails todo={{ ...TODO, status: 'done', folder: '' }} />);
    expect(html).toContain('todo-due--later');
    expect(text(html)).toContain('top level');
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
