import React from 'react';
import { Box, Text } from 'ink';
import type { Todo, TodoStatus } from '@fomo/core';

export type TodoFormField = 'subject' | 'due' | 'description';

interface Props {
  todos: Todo[];
  selectedIndex: number;
  height: number;
  columns: number;
  addMode: boolean;
  formField: TodoFormField;
  formSubject: string;
  formDue: string;
  formDesc: string;
  message?: string;
}

const STATUS_ICON: Record<TodoStatus, string> = {
  pending: '○',
  in_progress: '◑',
  done: '●',
};

const STATUS_COLOR: Record<TodoStatus, string> = {
  pending: '#8b949e',
  in_progress: '#e3b341',
  done: '#3fb950',
};

const STATUS_NEXT_LABEL: Record<TodoStatus, string> = {
  pending: 'pending → in_progress → done',
  in_progress: 'in_progress → done → pending',
  done: 'done → pending → in_progress',
};

function formatDue(dueDate?: string): string {
  if (!dueDate) return '';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(dueDate + 'T00:00:00');
  const diff = Math.floor((d.getTime() - today.getTime()) / 86_400_000);
  if (diff < 0) return `OVERDUE(${-diff}d)`;
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  return `in ${diff}d`;
}

export function TodosView({
  todos,
  selectedIndex,
  height,
  columns,
  addMode,
  formField,
  formSubject,
  formDue,
  formDesc,
  message,
}: Props) {
  // Reserve lines: header(1) + hint bar(1) + optional add-form(4) + optional message(1)
  const formLines = addMode ? 5 : 0;
  const msgLines = message ? 1 : 0;
  const headerLines = 2;
  const listH = Math.max(1, height - headerLines - formLines - msgLines);

  const start = Math.max(0, selectedIndex - Math.floor(listH / 2));
  const visible = todos.slice(start, start + listH);

  return (
    <Box flexDirection="column" width={columns}>
      {/* Header */}
      <Box width={columns} borderStyle="single" borderBottom borderTop={false} borderLeft={false} borderRight={false} borderColor="gray">
        <Text color="#58a6ff" bold> ✓ Todos </Text>
        <Text color="#8b949e"> · {todos.length} item{todos.length !== 1 ? 's' : ''} </Text>
        {!addMode && <Text color="#8b949e"> [a] add  [Enter] cycle status  [d] delete  [t] close </Text>}
      </Box>

      {/* Add form */}
      {addMode && (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="#1c7cd6"
          paddingX={1}
          marginBottom={0}
          width={columns - 2}
        >
          <Text color="#58a6ff" bold> Add Todo</Text>
          <Box gap={1}>
            <Text color={formField === 'subject' ? '#f0f6fc' : '#8b949e'}>Subject: </Text>
            <Text color="#f0f6fc">
              {formSubject}
              {formField === 'subject' ? <Text backgroundColor="#58a6ff" color="#0d1117">▋</Text> : null}
            </Text>
          </Box>
          <Box gap={1}>
            <Text color={formField === 'due' ? '#f0f6fc' : '#8b949e'}>Due date: </Text>
            <Text color="#f0f6fc">
              {formDue}
              {formField === 'due' ? <Text backgroundColor="#58a6ff" color="#0d1117">▋</Text> : null}
            </Text>
            <Text color="#8b949e">(YYYY-MM-DD)</Text>
          </Box>
          <Box gap={1}>
            <Text color={formField === 'description' ? '#f0f6fc' : '#8b949e'}>Description: </Text>
            <Text color="#f0f6fc">
              {formDesc}
              {formField === 'description' ? <Text backgroundColor="#58a6ff" color="#0d1117">▋</Text> : null}
            </Text>
          </Box>
          <Text color="#8b949e"> [Tab] next field  [Enter] save  [Esc] cancel</Text>
        </Box>
      )}

      {/* Message */}
      {message && <Text color="#e3b341"> {message}</Text>}

      {/* Empty state */}
      {todos.length === 0 && !addMode && (
        <Box height={listH} alignItems="center" justifyContent="center">
          <Text color="#8b949e">No todos yet. Press [a] to add one.</Text>
        </Box>
      )}

      {/* Todo list */}
      {visible.map((todo, i) => {
        const absIdx = start + i;
        const isSelected = absIdx === selectedIndex;
        const overdue = todo.dueDate && todo.status !== 'done' && new Date(todo.dueDate + 'T23:59:59') < new Date();
        const dueStr = formatDue(todo.dueDate);
        const subjectWidth = Math.max(20, columns - 6 - (dueStr ? dueStr.length + 2 : 0));
        const truncSubject =
          todo.subject.length > subjectWidth
            ? todo.subject.slice(0, subjectWidth - 1) + '…'
            : todo.subject.padEnd(subjectWidth);

        return (
          <Box key={todo.id} width={columns}>
            <Text
              color={isSelected ? '#0d1117' : STATUS_COLOR[todo.status]}
              backgroundColor={isSelected ? '#58a6ff' : undefined}
            >
              {' '}
              {STATUS_ICON[todo.status]}
              {' '}
            </Text>
            <Text
              color={isSelected ? '#0d1117' : todo.status === 'done' ? '#8b949e' : '#c9d1d9'}
              backgroundColor={isSelected ? '#58a6ff' : undefined}
              strikethrough={todo.status === 'done'}
            >
              {truncSubject}
            </Text>
            {dueStr && (
              <Text
                color={isSelected ? '#0d1117' : overdue ? '#f85149' : '#8b949e'}
                backgroundColor={isSelected ? '#58a6ff' : undefined}
              >
                {' '}{dueStr}
              </Text>
            )}
          </Box>
        );
      })}

      {/* Bottom hint for selected item */}
      {todos[selectedIndex] && !addMode && (
        <Box borderStyle="single" borderTop borderBottom={false} borderLeft={false} borderRight={false} borderColor="gray">
          <Text color="#8b949e" dimColor>
            {' '}Cycles: {STATUS_NEXT_LABEL[todos[selectedIndex].status]}
            {todos[selectedIndex].description ? `  · ${todos[selectedIndex].description.slice(0, 60)}` : ''}
          </Text>
        </Box>
      )}
    </Box>
  );
}
