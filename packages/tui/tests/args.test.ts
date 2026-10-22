import { describe, expect, it } from 'vitest';
import { parseArgs } from '../src/args.js';

describe('parseArgs', () => {
  it('runs the UI without arguments', () => {
    expect(parseArgs([])).toEqual({ kind: 'run', profile: undefined });
  });

  it('takes the profile from --profile, --profile= and -p', () => {
    expect(parseArgs(['--profile', 'work'])).toEqual({ kind: 'run', profile: 'work' });
    expect(parseArgs(['--profile=work'])).toEqual({ kind: 'run', profile: 'work' });
    expect(parseArgs(['-p', 'private'])).toEqual({ kind: 'run', profile: 'private' });
  });

  it('uses the last profile when it is given twice', () => {
    expect(parseArgs(['-p', 'a', '--profile=b'])).toEqual({ kind: 'run', profile: 'b' });
  });

  it('asks for a name when the flag has none', () => {
    expect(parseArgs(['--profile'])).toMatchObject({ kind: 'error', message: expect.stringContaining('needs a profile name') });
    expect(parseArgs(['-p'])).toMatchObject({ kind: 'error', message: expect.stringContaining('-p needs a profile name') });
    expect(parseArgs(['--profile='])).toMatchObject({ kind: 'error', message: expect.stringContaining('needs a profile name') });
  });

  it('rejects anything else, since there are no subcommands', () => {
    expect(parseArgs(['fetch'])).toMatchObject({ kind: 'error', message: expect.stringContaining('Unknown argument “fetch”') });
    expect(parseArgs(['-p', 'work', 'extra'])).toMatchObject({ kind: 'error' });
  });

  it('prints the version or the help before anything else', () => {
    expect(parseArgs(['--version'])).toEqual({ kind: 'version' });
    expect(parseArgs(['-v'])).toEqual({ kind: 'version' });
    expect(parseArgs(['--help'])).toEqual({ kind: 'help' });
    expect(parseArgs(['-h', '--profile', 'work'])).toEqual({ kind: 'help' });
    expect(parseArgs(['--profile', 'work', '--version'])).toEqual({ kind: 'version' });
  });
});
