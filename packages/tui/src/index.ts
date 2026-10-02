#!/usr/bin/env node
import { render } from 'ink';
import { createElement } from 'react';
import { CONFIG_FILE, loadConfig } from './config.js';
import { SummarizerCache } from './copilot.js';
import { Root } from './ui/Root.js';
import { enterFullScreen } from './ui/screen.js';

const VERSION = '0.1.0';

const USAGE = `📰 FOMO — release & update tracker (v${VERSION})

Usage: fomo    open the terminal UI

Everything happens inside the UI:
  f   fetch all sources and group them into topics with Copilot
  c   config: sources, local settings, link a device, regroup, backup / restore
  t   todos
  h   keyboard help

Local config: ${CONFIG_FILE}
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

  const config = loadConfig();
  const summarizers = new SummarizerCache();
  const restoreScreen = enterFullScreen();
  try {
    const { waitUntilExit } = render(createElement(Root, { initialConfig: config, summarizers }));
    await waitUntilExit();
  } finally {
    restoreScreen();
    await summarizers.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
