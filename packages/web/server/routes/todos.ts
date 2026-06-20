import { Hono } from 'hono';
import { TodoStore } from '@fomo/core/store';
import type { CreateTodoRequest, UpdateTodoRequest, TodoStatus } from '@fomo/core';

const VALID_STATUSES: TodoStatus[] = ['pending', 'in_progress', 'done'];

export function todosRouter(todoStore: TodoStore) {
  const router = new Hono();

  // GET /todos
  router.get('/', async (c) => {
    const statusParam = c.req.query('status') as TodoStatus | 'all' | undefined;

    if (statusParam && statusParam !== 'all' && !VALID_STATUSES.includes(statusParam as TodoStatus)) {
      return c.json({ error: `Invalid status. Must be one of: all, ${VALID_STATUSES.join(', ')}` }, 400);
    }

    const result = await todoStore.listTodos({ status: statusParam });
    return c.json(result);
  });

  // GET /todos/:id
  router.get('/:id', async (c) => {
    const id = c.req.param('id');
    const todo = await todoStore.getTodo(id);
    if (!todo) return c.json({ error: 'Not found' }, 404);
    return c.json(todo);
  });

  // POST /todos
  router.post('/', async (c) => {
    let body: CreateTodoRequest;
    try {
      body = await c.req.json<CreateTodoRequest>();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    if (!body.subject || typeof body.subject !== 'string' || body.subject.trim() === '') {
      return c.json({ error: 'subject is required' }, 400);
    }

    const todo = await todoStore.createTodo({
      subject: body.subject.trim(),
      description: typeof body.description === 'string' ? body.description.trim() : undefined,
      dueDate: typeof body.dueDate === 'string' ? body.dueDate : undefined,
    });
    return c.json(todo, 201);
  });

  // PATCH /todos/:id
  router.patch('/:id', async (c) => {
    const id = c.req.param('id');

    const existing = await todoStore.getTodo(id);
    if (!existing) return c.json({ error: 'Not found' }, 404);

    let body: UpdateTodoRequest;
    try {
      body = await c.req.json<UpdateTodoRequest>();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    if (body.status !== undefined && !VALID_STATUSES.includes(body.status as TodoStatus)) {
      return c.json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` }, 400);
    }

    const updated = await todoStore.updateTodo(id, body);
    return c.json(updated);
  });

  // DELETE /todos/:id
  router.delete('/:id', async (c) => {
    const id = c.req.param('id');
    await todoStore.deleteTodo(id);
    return c.body(null, 204);
  });

  return router;
}
