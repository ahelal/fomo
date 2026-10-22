#!/usr/bin/env node
import { render } from 'ink';
import { createElement } from 'react';
import { AUDIT_FILE, CONFIG_FILE, LOG_FILE, loadConfig, selectProfile } from './config.js';
import { parseArgs } from './args.js';
import { createAuditLog } from './audit.js';
import { SummarizerCache } from './copilot.js';
import { Root } from './ui/Root.js';
import { enterFullScreen } from './ui/screen.js';
import { VERSION } from './version.js';

const USAGE = `📰 FOMO — release & update tracker (v${VERSION})

Usage: fomo [-p <name>]    open the terminal UI

Options:
  -p, --profile <name>  open this profile (storage account) instead of the one used last
                        (or set FOMO_PROFILE)
  -v, --version         print the version
  -h, --help            show this help

Everything happens inside the UI:
  f   fetch all sources and group them into topics with Copilot
  w   switch profile: add, rename and remove storage accounts
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
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.kind === 'version') {
    console.log(VERSION);
    return;
  }
  if (parsed.kind === 'help') {
    console.log(USAGE);
    return;
  }
  if (parsed.kind === 'error') {
    console.error(`${parsed.message}\n\n${USAGE}`);
    process.exitCode = 1;
    return;
  }

  const audit = createAuditLog(AUDIT_FILE);
  audit.log('app', `started v${VERSION}`);
  // Observes crashes (including unhandled rejections) without changing how they end the process.
  process.on('uncaughtExceptionMonitor', (err) => audit.error('crash', err instanceof Error && err.stack ? err.stack : err));
  const summarizers = new SummarizerCache();
  let restoreScreen: (() => void) | undefined;
  try {
    // Inside the try so startup failures (e.g. a malformed config.json or an unknown profile) are audited too.
    const profile = selectProfile(parsed.profile ?? process.env.FOMO_PROFILE);
    const config = loadConfig(profile);
    restoreScreen = enterFullScreen(LOG_FILE, (text) => audit.error('console', text));
    // Console output goes to LOG_FILE (see enterFullScreen); Ink's console patch would print it over the UI.
    const { waitUntilExit } = render(
      createElement(Root, { initialProfile: profile, initialConfig: config, summarizers, audit, auditFile: AUDIT_FILE }),
      { patchConsole: false },
    );
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
