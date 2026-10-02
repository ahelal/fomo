import React, { useCallback, useMemo, useState } from 'react';
import { FomoDirectService, type PostGistResult } from '@fomo/core/service';
import type { DigestResult } from '@fomo/core/digest';
import { connectionStringProblem, saveConfig, type LocalConfig } from '../config.js';
import type { SummarizerCache } from '../copilot.js';
import { App, type DigestRunOptions } from './App.js';
import { SetupScreen } from './components/SetupScreen.js';

interface Props {
  initialConfig: LocalConfig;
  summarizers: SummarizerCache;
}

function createService(connectionString?: string): { service?: FomoDirectService; error?: string } {
  if (!connectionString) return {};
  try {
    return { service: new FomoDirectService(connectionString) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/** Owns the local config: shows first-time setup until there is a working connection, then the app. */
export function Root({ initialConfig, summarizers }: Props) {
  const [config, setConfig] = useState(initialConfig);
  const { service, error } = useMemo(() => createService(config.connectionString), [config.connectionString]);

  /** Save a config change; returns an error message when the file can't be written. */
  const updateConfig = useCallback((patch: Partial<LocalConfig>): string | undefined => {
    try {
      setConfig(saveConfig(patch));
      return undefined;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }, []);

  const digest = useCallback(
    (onProgress: (message: string) => void, options: DigestRunOptions = {}): Promise<DigestResult> => {
      if (!service) return Promise.reject(new Error('Not connected to storage'));
      return service.digest(summarizers.get(config.copilotModel), {
        onProgress,
        interests: config.interests,
        groupingHints: config.groupingHints,
        maxItems: config.digestMaxItems,
        reset: options.reset,
      });
    },
    [service, summarizers, config.copilotModel, config.interests, config.groupingHints, config.digestMaxItems],
  );

  const summarize = useCallback(
    (id: string, force = false): Promise<PostGistResult> => {
      if (!service) return Promise.reject(new Error('Not connected to storage'));
      return service.summarizePost(id, summarizers.get(config.copilotModel), { force });
    },
    [service, summarizers, config.copilotModel],
  );

  const connect = useCallback(
    async (connectionString: string, skipCheck: boolean): Promise<string | undefined> => {
      const problem = connectionStringProblem(connectionString);
      if (problem) return problem;
      if (!skipCheck) {
        const created = createService(connectionString);
        if (!created.service) return created.error ?? 'Invalid connection string';
        try {
          await created.service.getStats();
        } catch (err) {
          return err instanceof Error ? err.message : String(err);
        }
      }
      return updateConfig({ connectionString });
    },
    [updateConfig],
  );

  if (!service) return <SetupScreen error={error} onSubmit={connect} />;

  return (
    <App
      key={config.connectionString}
      service={service}
      config={config}
      onConfigChange={updateConfig}
      digest={digest}
      summarize={summarize}
    />
  );
}
