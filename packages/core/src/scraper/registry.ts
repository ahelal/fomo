import type { SourcePlugin } from '../types.js';
import { githubSource } from './sources/github.js';
import { azureSource } from './sources/azure.js';
import { vscodeSource } from './sources/vscode.js';
import { copilotCliSource } from './sources/copilot-cli.js';
import { theRegisterSource } from './sources/theregister.js';

/**
 * Central plugin registry.
 *
 * To add a new source:
 *   1. Create `packages/core/src/scraper/sources/<name>.ts` implementing `SourcePlugin`.
 *   2. Import it here and add it to the `builtins` array.
 */
const registry = new Map<string, SourcePlugin>();

const builtins: SourcePlugin[] = [githubSource, azureSource, vscodeSource, copilotCliSource, theRegisterSource];
for (const plugin of builtins) {
  registry.set(plugin.id, plugin);
}

export function getSource(id: string): SourcePlugin | undefined {
  return registry.get(id);
}

export function getAllSources(): SourcePlugin[] {
  return [...registry.values()];
}

export function getSourceIds(): string[] {
  return [...registry.keys()];
}

/** Allow runtime registration of additional plugins (e.g. from config). */
export function registerSource(plugin: SourcePlugin): void {
  registry.set(plugin.id, plugin);
}
