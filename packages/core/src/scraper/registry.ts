import type { AppSettings, SourceDeps, SourcePlugin } from '../types.js';
import { createSource } from './factory.js';
import { activeSourceSpecs } from './specs.js';

/**
 * The sources to fetch: built-ins (`specs.ts`) minus the ones the user removed, plus the user's own.
 *
 * To add a built-in, append a spec to `BUILTIN_SOURCES` in `specs.ts`. If no spec kind fits,
 * ship a sandboxed extension in `packages/extensions/` and inject its adapter from the TUI.
 */
type SourceSettings = Partial<Pick<AppSettings, 'userSources' | 'removedSources'>>;

export function getAllSources(settings: SourceSettings = {}, deps: SourceDeps = {}): SourcePlugin[] {
  return activeSourceSpecs(settings).map((spec) => createSource(spec, deps));
}

export function getSource(id: string, settings: SourceSettings = {}, deps: SourceDeps = {}): SourcePlugin | undefined {
  const spec = activeSourceSpecs(settings).find((s) => s.id === id);
  return spec && createSource(spec, deps);
}

export function getSourceIds(settings: SourceSettings = {}): string[] {
  return activeSourceSpecs(settings).map((s) => s.id);
}

export { createSource } from './factory.js';
export { parseFeed } from './feed.js';
export * from './specs.js';
