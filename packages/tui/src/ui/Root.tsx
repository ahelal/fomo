import React, { useCallback, useMemo, useState } from 'react';
import { FomoDirectService, type PostGistResult, type SuggestReferenceRequest } from '@fomo/core/service';
import type { ReferenceSuggestion } from '@fomo/core';
import type { DigestResult } from '@fomo/core/digest';
import { connectionStringProblem, saveConfig, type LocalConfig } from '../config.js';
import type { SummarizerCache } from '../copilot.js';
import type { AuditLog } from '../audit.js';
import { App, type DigestRunOptions } from './App.js';
import { SetupScreen } from './components/SetupScreen.js';

interface Props {
  initialConfig: LocalConfig;
  summarizers: SummarizerCache;
  audit?: AuditLog;
  auditFile?: string;
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
export function Root({ initialConfig, summarizers, audit, auditFile }: Props) {
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
      return service.digest(summarizers.get(config.copilotModel, config.copilotAccount), {
        onProgress,
        interests: config.interests,
        groupingHints: config.groupingHints,
        maxItems: config.digestMaxItems,
        reset: options.reset,
      });
    },
    [service, summarizers, config.copilotModel, config.copilotAccount, config.interests, config.groupingHints, config.digestMaxItems],
  );

  const summarize = useCallback(
    (id: string, force = false): Promise<PostGistResult> => {
      if (!service) return Promise.reject(new Error('Not connected to storage'));
      return service.summarizePost(id, summarizers.get(config.copilotModel, config.copilotAccount), { force });
    },
    [service, summarizers, config.copilotModel, config.copilotAccount],
  );

  const suggestReference = useCallback(
    (req: SuggestReferenceRequest): Promise<ReferenceSuggestion> => {
      if (!service) return Promise.reject(new Error('Not connected to storage'));
      return service.suggestReference(req, summarizers.get(config.copilotModel, config.copilotAccount));
    },
    [service, summarizers, config.copilotModel, config.copilotAccount],
  );

  const connect = useCallback(
    async (connectionString: string, skipCheck: boolean): Promise<string | undefined> => {
      const fail = (problem: string) => {
        audit?.error('setup', problem);
        return problem;
      };
      const problem = connectionStringProblem(connectionString);
      if (problem) return fail(problem);
      if (!skipCheck) {
        const created = createService(connectionString);
        if (!created.service) return fail(created.error ?? 'Invalid connection string');
        try {
          await created.service.getStats();
        } catch (err) {
          return fail(err instanceof Error ? err.message : String(err));
        }
      }
      const saveError = updateConfig({ connectionString });
      if (saveError) return fail(saveError);
      audit?.log('setup', `connected${skipCheck ? ' (check skipped)' : ''}`);
      return undefined;
    },
    [updateConfig, audit],
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
      suggestReference={suggestReference}
      audit={audit}
      auditFile={auditFile}
    />
  );
}
