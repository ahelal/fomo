import { realpath } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ContainerRequest, MxcProcess } from '@microsoft/mxc-sdk/v1';

const execute = promisify(execFile);
const active = new Set<MxcProcess>();
const closing = new WeakMap<MxcProcess, Promise<void>>();
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const literal = (path: string) => `(literal ${JSON.stringify(path)})`;
const subtree = (path: string) => `(subpath ${JSON.stringify(path)})`;

export interface SandboxLaunch {
  executable: string;
  args: readonly string[];
  directory: string;
  readonlyPaths: readonly string[];
  readwritePaths?: readonly string[];
  timeoutMs: number;
}

let nodeImages: Promise<string[]> | undefined;
async function runtimeImages(): Promise<string[]> {
  nodeImages ??= (async () => {
    const { stdout } = await execute(process.execPath, [
      '--openssl-config=/dev/null', '-p', 'JSON.stringify(process.report.getReport().sharedObjects)',
    ], { env: {}, timeout: 5000, maxBuffer: 256 * 1024 });
    const images: unknown = JSON.parse(stdout);
    if (!Array.isArray(images) || images.some((p) => typeof p !== 'string' || !p.startsWith('/'))) {
      throw new Error('Could not determine the Node runtime libraries for isolation');
    }
    const paths = new Set<string>(images);
    for (const path of images) {
      try { paths.add(await realpath(path)); } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
        // macOS also reports images that live only in the dyld shared cache.
      }
    }
    return [...paths];
  })();
  return nodeImages;
}

/** An explicit policy, not MXC's broader default system/home allowances. */
export function seatbeltProfile(input: SandboxLaunch, images: readonly string[]): string {
  const read = [...input.readonlyPaths, input.directory];
  const write = input.readwritePaths ?? [];
  return [
    '(version 1)',
    '(deny default)',
    '(allow file-read-metadata)',
    // The macOS loader needs to inspect / itself, not its descendants.
    '(allow file-read-data (literal "/"))',
    '(allow sysctl-read)',
    '(allow signal (target self))',
    `(allow process-exec ${['/bin/sh', '/bin/bash', input.executable].map(literal).join(' ')})`,
    `(allow file-read* file-map-executable ${['/bin/sh', '/bin/bash', input.executable, ...images].map(literal).join(' ')})`,
    '(allow file-read* file-map-executable (subpath "/System/Library") (subpath "/usr/lib"))',
    '(allow file-read* (subpath "/usr/share/icu") (subpath "/private/var/db/timezone") (literal "/dev/null") (literal "/dev/zero") (literal "/dev/random") (literal "/dev/urandom"))',
    '(allow file-write* (literal "/dev/null"))',
    ...write.map((path) => `(allow file-read* file-write* ${subtree(path)})`),
    ...read.map((path) => `(allow file-read* ${subtree(path)})`),
    ...input.readonlyPaths.map((path) => `(deny file-write* ${subtree(path)})`),
    '(deny process-fork)',
    '(deny network*)',
  ].join('\n');
}

export async function spawnSandbox(input: SandboxLaunch): Promise<MxcProcess> {
  if (process.platform !== 'darwin') {
    throw new Error('Extension sandbox unsupported: the hardened MXC policy is currently verified only on macOS');
  }
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 24) throw new Error('Extension sandbox requires Node 24 or newer');
  const { spawn, getPlatformSupport } = await import('@microsoft/mxc-sdk/v1');
  const support = getPlatformSupport();
  if (!support.isSupported || !support.availableMethods.includes('seatbelt')) {
    throw new Error(`Extension sandbox unavailable: ${support.reason || 'MXC Seatbelt backend is missing'}`);
  }
  const executable = await realpath(input.executable);
  const directory = await realpath(input.directory);
  const launch: SandboxLaunch = {
    ...input, executable, directory,
    readonlyPaths: await Promise.all(input.readonlyPaths.map((p) => realpath(p))),
    readwritePaths: await Promise.all((input.readwritePaths ?? []).map((p) => realpath(p))),
  };
  const request: ContainerRequest = {
    command: `ulimit -t 60 && exec ${[executable, ...input.args].map(quote).join(' ')}`,
    workingDirectory: directory,
    environment: {
      HOME: directory, TMPDIR: directory, LANG: 'C.UTF-8',
      DOTNET_EnableDiagnostics: '0', DOTNET_CLI_TELEMETRY_OPTOUT: '1',
    },
    inheritDefaultEnvironment: false,
    containment: {
      type: 'seatbelt',
      config: {
        profileOverride: seatbeltProfile(launch, await runtimeImages()),
        nestedPty: false, keychainAccess: false, guiAccess: false,
      },
    },
    timeoutMs: input.timeoutMs,
  };
  const child = await spawn(request, { telemetry: { enabled: false } });
  if (child.warnings.length) {
    await closeSandbox(child);
    throw new Error(`Extension isolation warning: ${child.warnings.join('; ')}`);
  }
  active.add(child);
  return child;
}

export function closeSandbox(child: MxcProcess): Promise<void> {
  const previous = closing.get(child);
  if (previous) return previous;
  const closed = (async () => {
    let killError: unknown;
    try {
      try { child.kill(); } catch (error) { killError = error; }
      // MXC can race a process that has already exited. Only a confirmed wait makes that harmless.
      try { await child.wait(); } catch (error) {
        throw killError ? new AggregateError([killError, error], 'Could not confirm sandbox shutdown') : error;
      }
    } finally { active.delete(child); child.dispose(); }
  })();
  closing.set(child, closed);
  return closed;
}

export async function closeAllSandboxes(): Promise<void> {
  await Promise.all([...active].map(closeSandbox));
}
