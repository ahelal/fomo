#!/usr/bin/env node
import { render } from 'ink';
import { createElement } from 'react';
import { AUDIT_FILE, CONFIG_FILE, LOG_FILE, loadConfig } from './config.js';
import { createAuditLog } from './audit.js';
import { SummarizerCache } from './copilot.js';
import { Root } from './ui/Root.js';
import { enterFullScreen } from './ui/screen.js';
import { VERSION } from './version.js';

const USAGE = `📰 FOMO — release & update tracker (v${VERSION})

Usage: fomo    open the terminal UI

Everything happens inside the UI:
  f   fetch all sources and group them into topics with Copilot
  c   config: sources, local settings, link a device, regroup, backup / restore
  t   todos
  b   references: links filed into folders (m files the selected update)
  a   audit trail of actions and errors
  h   keyboard help

Local config: ${CONFIG_FILE}
Log file:     ${LOG_FILE}
Audit trail:  ${AUDIT_FILE}
`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--version') || args.includes('-v')) {
    console.log(VERSION);
    return;
  }
  if (args.length > 0) {
    const help = args.includes('--help') || args.includes('-h');
    (help ? console.log : console.error)(
      help ? USAGE : `fomo has no subcommands any more; run \`fomo\` and use the UI.\n\n${USAGE}`,
    );
    if (!help) process.exitCode = 1;
    return;
  }

  const audit = createAuditLog(AUDIT_FILE);
  audit.log('app', `started v${VERSION}`);
  // Observes crashes (including unhandled rejections) without changing how they end the process.
  process.on('uncaughtExceptionMonitor', (err) => audit.error('crash', err instanceof Error && err.stack ? err.stack : err));
  const summarizers = new SummarizerCache();
  let restoreScreen: (() => void) | undefined;
  try {
    // Inside the try so startup failures (e.g. a malformed config.json) are audited too.
    const config = loadConfig();
    restoreScreen = enterFullScreen(LOG_FILE, (text) => audit.error('console', text));
    // Console output goes to LOG_FILE (see enterFullScreen); Ink's console patch would print it over the UI.
    const { waitUntilExit } = render(createElement(Root, { initialConfig: config, summarizers, audit, auditFile: AUDIT_FILE }), {
      patchConsole: false,
    });
    await waitUntilExit();
    audit.log('app', 'quit');
  } catch (err) {
    audit.error('crash', err instanceof Error && err.stack ? err.stack : err);
    throw err;
  } finally {
    restoreScreen?.();
    await summarizers.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
