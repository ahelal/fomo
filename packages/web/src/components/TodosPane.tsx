import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { FomoClient } from '@fomo/core';
import type { Todo, TodoStatus, CreateTodoRequest } from '@fomo/core';

interface Props {
  client: FomoClient;
}

const STATUS_LABELS: Record<TodoStatus, string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  done: 'Done',
};

const STATUS_NEXT: Record<TodoStatus, TodoStatus> = {
  pending: 'in_progress',
  in_progress: 'done',
  done: 'pending',
};

function formatDueDate(dueDate?: string): string {
  if (!dueDate) return '';
  const d = new Date(dueDate + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.floor((d.getTime() - today.getTime()) / 86_400_000);
  if (diff < 0) return `Overdue by ${-diff}d`;
  if (diff === 0) return 'Due today';
  if (diff === 1) return 'Due tomorrow';
  return `Due in ${diff}d`;
}

export function TodosPane({ client }: Props) {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [showForm, setShowForm] = useState(false);
  const [filterStatus, setFilterStatus] = useState<TodoStatus | 'all'>('all');
  const [expandedId, setExpandedId] = useState<string | undefined>();

  // Form state
  const [formSubject, setFormSubject] = useState('');
  const [formDue, setFormDue] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formError, setFormError] = useState<string | undefined>();
  const subjectRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const resp = await client.listTodos({ status: filterStatus });
      setTodos(resp.todos);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [client, filterStatus]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (showForm) subjectRef.current?.focus();
  }, [showForm]);

  const handleCycleStatus = useCallback(
    async (todo: Todo) => {
      const next = STATUS_NEXT[todo.status];
      setTodos((prev) => prev.map((t) => (t.id === todo.id ? { ...t, status: next } : t)));
      try {
        await client.updateTodo(todo.id, { status: next });
        void load();
      } catch {
        void load(); // revert on error
      }
    },
    [client, load],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      setTodos((prev) => prev.filter((t) => t.id !== id));
      try {
        await client.deleteTodo(id);
      } catch {
        void load(); // revert on error
      }
    },
    [client, load],
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!formSubject.trim()) {
        setFormError('Subject is required');
        return;
      }
      setFormError(undefined);
      const req: CreateTodoRequest = {
        subject: formSubject.trim(),
        description: formDesc.trim() || undefined,
        dueDate: formDue || undefined,
      };
      try {
        const created = await client.createTodo(req);
        setTodos((prev) => [created, ...prev]);
        setFormSubject('');
        setFormDue('');
        setFormDesc('');
        setShowForm(false);
        void load();
      } catch (err) {
        setFormError(err instanceof Error ? err.message : String(err));
      }
    },
    [client, formSubject, formDue, formDesc, load],
  );

  const filtered = filterStatus === 'all'
    ? todos
    : todos.filter((t) => t.status === filterStatus);

  return (
    <div className="todos-pane">
      <div className="todos-header">
        <div className="todos-filters">
          {(['all', 'pending', 'in_progress', 'done'] as const).map((s) => (
            <button
              key={s}
              className={['todos-filter-pill', filterStatus === s ? 'todos-filter-pill--active' : ''].join(' ')}
              onClick={() => setFilterStatus(s)}
            >
              {s === 'all' ? 'All' : STATUS_LABELS[s]}
            </button>
          ))}
        </div>
        <button className="todos-add-btn" onClick={() => setShowForm((v) => !v)}>
          {showForm ? '✕ Cancel' : '+ Add Todo'}
        </button>
      </div>

      {showForm && (
        <form className="todos-form" onSubmit={handleSubmit}>
          <div className="todos-form__row">
            <input
              ref={subjectRef}
              className="todos-form__input todos-form__input--subject"
              placeholder="Subject *"
              value={formSubject}
              onChange={(e) => setFormSubject(e.target.value)}
              required
            />
            <input
              className="todos-form__input todos-form__input--due"
              type="date"
              placeholder="Due date"
              value={formDue}
              onChange={(e) => setFormDue(e.target.value)}
            />
          </div>
          <textarea
            className="todos-form__textarea"
            placeholder="Description (optional)"
            value={formDesc}
            onChange={(e) => setFormDesc(e.target.value)}
            rows={2}
          />
          {formError && <p className="todos-form__error">{formError}</p>}
          <div className="todos-form__actions">
            <button type="submit" className="todos-form__submit">Add Todo</button>
            <button type="button" className="todos-form__cancel" onClick={() => { setShowForm(false); setFormError(undefined); }}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {error && <p className="todos-error">{error}</p>}
      {loading && !todos.length && <p className="todos-loading">Loading…</p>}

      {!loading && filtered.length === 0 && (
        <div className="todos-empty">
          <p>{filterStatus === 'all' ? 'No todos yet. Add one above!' : `No ${filterStatus.replace('_', ' ')} todos.`}</p>
        </div>
      )}

      <ul className="todos-list">
        {filtered.map((todo) => {
          const overdue = todo.dueDate && todo.status !== 'done' && new Date(todo.dueDate + 'T23:59:59') < new Date();
          const expanded = expandedId === todo.id;
          return (
            <li
              key={todo.id}
              className={[
                'todo-item',
                `todo-item--${todo.status}`,
                overdue ? 'todo-item--overdue' : '',
              ].join(' ')}
            >
              <div className="todo-item__main">
                <button
                  className={`todo-item__status-badge todo-item__status-badge--${todo.status}`}
                  onClick={() => void handleCycleStatus(todo)}
                  title={`Status: ${STATUS_LABELS[todo.status]} — click to advance`}
                >
                  {todo.status === 'pending' ? '○' : todo.status === 'in_progress' ? '◑' : '●'}
                </button>
                <button
                  className="todo-item__subject"
                  onClick={() => setExpandedId(expanded ? undefined : todo.id)}
                >
                  {todo.subject}
                </button>
                <span className={['todo-item__due', overdue ? 'todo-item__due--overdue' : ''].join(' ')}>
                  {formatDueDate(todo.dueDate)}
                </span>
                <button
                  className="todo-item__delete"
                  onClick={() => void handleDelete(todo.id)}
                  title="Delete"
                >
                  ✕
                </button>
              </div>
              {expanded && (
                <div className="todo-item__detail">
                  {todo.description && <p className="todo-item__description">{todo.description}</p>}
                  <p className="todo-item__meta">
                    Status: <strong>{STATUS_LABELS[todo.status]}</strong>
                    {todo.dueDate && <> · Due: <strong>{todo.dueDate}</strong></>}
                    · Created: {todo.createdAt.slice(0, 10)}
                  </p>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
