export type ParsedArgs =
  | { kind: 'run'; profile?: string }
  | { kind: 'version' }
  | { kind: 'help' }
  | { kind: 'error'; message: string };

/** Command line: no subcommands, just `--profile <name>` (`-p`, or `--profile=<name>`), `--version` and `--help`. */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  if (argv.includes('--version') || argv.includes('-v')) return { kind: 'version' };
  if (argv.includes('--help') || argv.includes('-h')) return { kind: 'help' };
  let profile: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--profile' || arg === '-p') {
      profile = argv[++i];
      if (!profile) return { kind: 'error', message: `${arg} needs a profile name` };
    } else if (arg.startsWith('--profile=')) {
      profile = arg.slice('--profile='.length);
      if (!profile) return { kind: 'error', message: '--profile needs a profile name' };
    } else {
      return { kind: 'error', message: `Unknown argument “${arg}”. fomo has no subcommands; run \`fomo\` and use the UI.` };
    }
  }
  return { kind: 'run', profile };
}
