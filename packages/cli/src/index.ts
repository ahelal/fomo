#!/usr/bin/env node
import { Command } from 'commander';
import { loadConfig, saveConfig, printConfig } from './config.js';
import { FomoDirectService } from '@fomo/core/service';

const program = new Command();

program
  .name('fomo')
  .description('📰 FOMO — Release & Update Tracker')
  .version('0.1.0');

// ── config ────────────────────────────────────────────────────────────────────
const configCmd = program.command('config').description('Manage connection config');

configCmd
  .command('set')
  .description('Set Azure Storage connection string')
  .requiredOption('--connection-string <cs>', 'Azure Storage connection string')
  .action(({ connectionString }: { connectionString: string }) => {
    saveConfig({ connectionString });
  });

configCmd
  .command('show')
  .description('Show current config')
  .action(() => printConfig());

configCmd
  .command('remote')
  .description('View or update remote (shared) settings')
  .option('--set <key=value>', 'Set a setting (e.g. previewPosition=bottom, pageSize=100)')
  .option('--enable-source <id>', 'Enable a disabled source')
  .option('--disable-source <id>', 'Disable a source from automatic fetch')
  .action(async (opts: { set?: string; enableSource?: string; disableSource?: string }) => {
    const svc = new FomoDirectService(loadConfig().connectionString);

    if (opts.set) {
      const eqIdx = opts.set.indexOf('=');
      if (eqIdx === -1) { console.error('Usage: --set key=value'); process.exit(1); }
      const key = opts.set.slice(0, eqIdx);
      const value = opts.set.slice(eqIdx + 1);
      const patch: Record<string, unknown> = {};
      patch[key] = key === 'pageSize' ? Number(value) : value;
      const updated = await svc.updateSettings(patch);
      console.log('✓ Settings updated');
      console.log(JSON.stringify(updated, null, 2));
      return;
    }

    if (opts.disableSource) {
      const current = await svc.getSettings();
      const disabled = new Set(current.disabledSources);
      disabled.add(opts.disableSource);
      const updated = await svc.updateSettings({ disabledSources: [...disabled] });
      console.log(`✓ Source '${opts.disableSource}' disabled`);
      console.log(JSON.stringify(updated, null, 2));
      return;
    }

    if (opts.enableSource) {
      const current = await svc.getSettings();
      const disabled = new Set(current.disabledSources);
      disabled.delete(opts.enableSource);
      const updated = await svc.updateSettings({ disabledSources: [...disabled] });
      console.log(`✓ Source '${opts.enableSource}' enabled`);
      console.log(JSON.stringify(updated, null, 2));
      return;
    }

    // No flags — show current remote settings
    const settings = await svc.getSettings();
    console.log('\n⚙️  Remote Settings\n');
    console.log(JSON.stringify(settings, null, 2));
    console.log('');
  });

// ── fetch ─────────────────────────────────────────────────────────────────────
program
  .command('fetch')
  .description('Scrape one or more sources and store results')
  .option('-s, --source <ids...>', 'Source IDs to fetch (default: all)')
  .action(async ({ source }: { source?: string[] }) => {
    const svc = new FomoDirectService(loadConfig().connectionString);
    process.stdout.write('🔄 Fetching updates…\n');
    const resp = await svc.fetch({ sources: source });
    console.log(`✓ Added ${resp.added} new update(s)`);
    for (const [id, result] of Object.entries(resp.results)) {
      const errPart = result.error ? `  ⚠ ${result.error}` : '';
      console.log(`  ${id}: fetched=${result.fetched} added=${result.added}${errPart}`);
    }
  });

// ── list ──────────────────────────────────────────────────────────────────────
program
  .command('list')
  .description('List updates')
  .option('-s, --status <status>', 'Filter: all | unread | read | saved', 'all')
  .option('--source <id>', 'Filter by source ID')
  .option('-l, --limit <n>', 'Max results', '20')
  .action(async ({ status, source, limit }: { status: string; source?: string; limit: string }) => {
    const svc = new FomoDirectService(loadConfig().connectionString);
    const resp = await svc.listUpdates({
      status: status as never,
      source,
      limit: Number(limit),
    });

    if (resp.updates.length === 0) {
      console.log('No updates found.');
      return;
    }

    const ICON: Record<string, string> = { unread: '📩', read: '✓ ', saved: '⭐' };
    for (const u of resp.updates) {
      const date = u.datePublished.slice(0, 10);
      const icon = ICON[u.status] ?? '? ';
      const title = u.title.length > 60 ? `${u.title.slice(0, 57)}…` : u.title;
      console.log(`${icon}  ${date}  ${u.source.padEnd(14)} ${title}`);
    }
    console.log(`\n${resp.updates.length} of ${resp.total} update(s)${resp.hasMore ? ' (more available)' : ''}`);
  });

// ── mark ──────────────────────────────────────────────────────────────────────
program
  .command('mark <id> <status>')
  .description('Set the status of an update (status: unread | read | saved)')
  .action(async (id: string, status: string) => {
    const svc = new FomoDirectService(loadConfig().connectionString);
    const update = await svc.setStatus(id, status as never);
    const ICON: Record<string, string> = { unread: '📩', read: '✓', saved: '⭐' };
    console.log(`${ICON[update.status] ?? ''} Update marked as ${update.status}: ${update.title}`);
  });

// ── stats ─────────────────────────────────────────────────────────────────────
program
  .command('stats')
  .description('Show update statistics')
  .action(async () => {
    const svc = new FomoDirectService(loadConfig().connectionString);
    const stats = await svc.getStats();
    console.log('\n📊 FOMO Statistics\n');
    console.log(`  Total  : ${stats.total}`);
    console.log(`  Unread : ${stats.byStatus.unread ?? 0}`);
    console.log(`  Read   : ${stats.byStatus.read ?? 0}`);
    console.log(`  Saved  : ${stats.saved ?? 0}`);
    console.log('\n  By Source:');
    for (const [src, count] of Object.entries(stats.bySource)) {
      console.log(`    ${src.padEnd(16)} ${count}`);
    }
    console.log('');
  });

// ── backup ────────────────────────────────────────────────────────────────────
program
  .command('backup [dir]')
  .description('Backup remote table to a local JSON file')
  .action(async (dir?: string) => {
    const { resolve, join } = await import('node:path');
    const { writeFileSync, mkdirSync } = await import('node:fs');

    const targetDir = resolve(dir ?? '.');
    mkdirSync(targetDir, { recursive: true });

    const svc = new FomoDirectService(loadConfig().connectionString);
    process.stdout.write('📦 Exporting updates from remote table…\n');
    const payload = await svc.backup();

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `fomo-backup-${timestamp}.json`;
    const filepath = join(targetDir, filename);

    writeFileSync(filepath, JSON.stringify(payload, null, 2));
    console.log(`✓ Backed up ${payload.count} update(s) → ${filepath}`);
  });

// ── restore ───────────────────────────────────────────────────────────────────
program
  .command('restore <file>')
  .description('Restore updates from a local backup JSON file')
  .action(async (file: string) => {
    const { resolve } = await import('node:path');
    const { readFileSync } = await import('node:fs');

    const filepath = resolve(file);
    const raw = readFileSync(filepath, 'utf-8');
    const payload = JSON.parse(raw);

    if (!payload.version || !Array.isArray(payload.entities)) {
      console.error('✗ Invalid backup file format.');
      process.exit(1);
    }

    const svc = new FomoDirectService(loadConfig().connectionString);
    process.stdout.write(`📥 Restoring ${payload.count} update(s) to remote table…\n`);
    const restored = await svc.restore(payload);
    console.log(`✓ Restored ${restored} update(s) from ${filepath}`);
  });

// ── ui ────────────────────────────────────────────────────────────────────────
program
  .command('ui')
  .description('Launch interactive TUI')
  .action(async () => {
    const { render } = await import('ink');
    const { createElement } = await import('react');
    const { App } = await import('./ui/App.js');
    const svc = new FomoDirectService(loadConfig().connectionString);

    // Alternate screen buffer: preserves primary scrollback on exit.
    const raw = process.stdout.write.bind(process.stdout);
    raw('\x1b[?1049h\x1b[?25l\x1b[H');

    // ── Flicker-free renderer ─────────────────────────────────────────────
    // Ink re-renders by clearing the ENTIRE screen then rewriting every
    // line, which causes a visible flash.  Two Ink code-paths do this:
    //
    //   1. outputHeight >= terminal rows  (always true for full-screen TUI):
    //      stdout.write( clearTerminal + output )
    //      clearTerminal = \x1b[2J \x1b[3J \x1b[H
    //
    //   2. Normal log-update path (smaller output):
    //      stdout.write( eraseLines(N) + output )
    //      eraseLines  = (\x1b[2K \x1b[1A)* \x1b[2K \x1b[G
    //
    // We intercept stdout.write, detect these prefixes, strip them, diff
    // the new frame against the previous one, and only rewrite the lines
    // that actually changed using absolute cursor addressing.

    const CLEAR_TERMINAL = '\x1b[2J\x1b[3J\x1b[H';
    const ERASE_LINES_RE = /^(?:\x1b\[2K(?:\x1b\[1A)?)+\x1b\[G/;
    let prevLines: string[] = [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.stdout as any).write = (chunk: unknown, ...rest: unknown[]): boolean => {
      if (typeof chunk !== 'string') {
        return (raw as (...a: unknown[]) => boolean)(chunk, ...rest);
      }

      // Detect and strip Ink's clear/erase prefix to isolate frame content.
      let content: string | null = null;
      if (chunk.startsWith(CLEAR_TERMINAL)) {
        content = chunk.slice(CLEAR_TERMINAL.length);
      } else if (chunk.startsWith('\x1b[2K')) {
        const m = ERASE_LINES_RE.exec(chunk);
        if (m) content = chunk.slice(m[0].length);
      }

      if (content === null) {
        // Not a frame (cursor-hide, first render, etc.) — pass through.
        return (raw as (...a: unknown[]) => boolean)(chunk, ...rest);
      }

      const newLines = content.split('\n');

      if (prevLines.length === 0) {
        // First frame — write in full from cursor home.
        prevLines = newLines;
        return raw('\x1b[H' + content);
      }

      // Diff: emit only the lines that changed.
      let buf = '\x1b[?2026h'; // begin synchronized output
      let changes = 0;
      const len = Math.max(prevLines.length, newLines.length);
      for (let i = 0; i < len; i++) {
        if ((prevLines[i] ?? '') !== (newLines[i] ?? '')) {
          buf += `\x1b[${i + 1};1H\x1b[2K${newLines[i] ?? ''}`;
          changes++;
        }
      }
      buf += '\x1b[?2026l'; // end synchronized output
      prevLines = newLines;
      return changes > 0 ? raw(buf) : true;
    };

    const { waitUntilExit } = render(createElement(App, { service: svc }));
    try {
      await waitUntilExit();
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (process.stdout as any).write = raw;
      raw('\x1b[?25h\x1b[?1049l');
    }
  });

// ── todo ──────────────────────────────────────────────────────────────────────
const todoCmd = program.command('todo').description('Manage personal todos');

todoCmd
  .command('add')
  .description('Add a new todo')
  .requiredOption('--subject <subject>', 'Todo subject/title')
  .option('--due <date>', 'Due date (YYYY-MM-DD)')
  .option('--description <text>', 'Optional description')
  .action(async (opts: { subject: string; due?: string; description?: string }) => {
    const svc = new FomoDirectService(loadConfig().connectionString);
    const todo = await svc.createTodo({
      subject: opts.subject,
      dueDate: opts.due,
      description: opts.description,
    });
    const dueStr = todo.dueDate ? ` (due ${todo.dueDate})` : '';
    console.log(`✓ Added todo: ${todo.subject}${dueStr}`);
    console.log(`  ID: ${todo.id}`);
  });

todoCmd
  .command('list')
  .description('List todos')
  .option('--status <status>', 'Filter: all | pending | in_progress | done', 'all')
  .action(async ({ status }: { status: string }) => {
    const svc = new FomoDirectService(loadConfig().connectionString);
    const resp = await svc.listTodos({ status: status as never });

    if (resp.todos.length === 0) {
      console.log('No todos found.');
      return;
    }

    const ICON: Record<string, string> = { pending: '○', in_progress: '◑', done: '●' };
    for (const t of resp.todos) {
      const icon = ICON[t.status] ?? '?';
      const dueStr = t.dueDate ? `  due:${t.dueDate}` : '';
      const subject = t.subject.length > 50 ? `${t.subject.slice(0, 47)}…` : t.subject;
      console.log(`${icon}  ${t.id.slice(0, 8)}  ${subject.padEnd(52)}${dueStr}`);
    }
    console.log(`\n${resp.todos.length} todo(s)`);
  });

todoCmd
  .command('set-status <id> <status>')
  .description('Update todo status (pending | in_progress | done)')
  .action(async (id: string, status: string) => {
    const svc = new FomoDirectService(loadConfig().connectionString);
    const todo = await svc.updateTodo(id, { status: status as never });
    const ICON: Record<string, string> = { pending: '○', in_progress: '◑', done: '●' };
    console.log(`${ICON[todo.status] ?? ''} Todo marked as ${todo.status}: ${todo.subject}`);
  });

todoCmd
  .command('delete <id>')
  .description('Delete a todo by ID')
  .action(async (id: string) => {
    const svc = new FomoDirectService(loadConfig().connectionString);
    await svc.deleteTodo(id);
    console.log(`✓ Deleted todo ${id}`);
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
