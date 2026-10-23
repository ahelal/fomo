import React, { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { FomoDirectService, type PostGistResult, type SuggestReferenceRequest } from '@fomo/core/service';
import type { ReferenceSuggestion } from '@fomo/core';
import type { DigestResult } from '@fomo/core/digest';
import {
  accountLabel,
  addProfile,
  connectionStringProblem,
  describeProfiles,
  loadConfig,
  profileNameProblem,
  removeProfile,
  renameProfile,
  saveConfig,
  setActiveProfile,
  type LocalConfig,
  type ProfileInfo,
} from '../config.js';
import type { SummarizerCache } from '../copilot.js';
import type { AuditLog } from '../audit.js';
import { experimentalProviders } from '../experimental/index.js';
import { App, type DigestRunOptions } from './App.js';
import { SetupScreen } from './components/SetupScreen.js';
import type { ProfileControls } from './hooks/useProfilePicker.js';

interface Props {
  /** Profile to open. */
  initialProfile: string;
  initialConfig: LocalConfig;
  summarizers: SummarizerCache;
  audit?: AuditLog;
  auditFile?: string;
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

function createService(connectionString?: string): { service?: FomoDirectService; error?: string } {
  if (!connectionString) return {};
  try {
    return { service: new FomoDirectService(connectionString) };
  } catch (err) {
    return { error: errorText(err) };
  }
}

/** Why a connection string can't be used: its shape, the Azure SDK, or (unless skipped) a live request. */
async function connectionProblem(connectionString: string, skipCheck: boolean): Promise<string | undefined> {
  const problem = connectionStringProblem(connectionString);
  if (problem) return problem;
  if (skipCheck) return undefined;
  const created = createService(connectionString);
  if (!created.service) return created.error ?? 'Invalid connection string';
  try {
    await created.service.getStats();
  } catch (err) {
    return errorText(err);
  }
  return undefined;
}

/** The profiles in the config file, or undefined when it can't be read right now. */
function readProfiles(): ProfileInfo[] | undefined {
  try {
    return describeProfiles();
  } catch {
    return undefined;
  }
}

/** Audit entries carry the profile name once there is more than one profile to tell apart. */
function stampAudit(audit: AuditLog | undefined, profile: string, profiles: ProfileInfo[]): void {
  audit?.setProfile(profiles.length > 1 ? profile : undefined);
}

/** The profile in use, its effective config and every profile's name: they change together. */
interface Session {
  profile: string;
  config: LocalConfig;
  profiles: ProfileInfo[];
  /** Confirmation for the app that opens with this session (a switch replaces the whole app, so it can't show it itself). */
  notice?: string;
}

/** Owns the local config: shows first-time setup until there is a working connection, then the app. */
export function Root({ initialProfile, initialConfig, summarizers, audit, auditFile }: Props) {
  const [session, setSession] = useState<Session>(() => ({
    profile: initialProfile,
    config: initialConfig,
    profiles: readProfiles() ?? [{ name: initialProfile }],
  }));
  const { profile, config, profiles, notice } = session;
  const { service, error } = useMemo(() => createService(config.connectionString), [config.connectionString]);

  // Before the children's effects, so that nothing they log goes untagged.
  useLayoutEffect(() => stampAudit(audit, profile, profiles), [audit, profile, profiles]);
  // Also before the children's effects, so that their first fetch runs the profile's experimental sources.
  useLayoutEffect(() => service?.setExperimentalProviders(experimentalProviders(config.experimentalSources)), [service, config.experimentalSources]);

  /** Save a change to the profile in use; returns an error message when the file can't be written. */
  const updateConfig = useCallback((patch: Partial<LocalConfig>): string | undefined => {
    try {
      const next = saveConfig(profile, patch);
      // Right away, so a fetch started in the same handler (turning a source on) runs it.
      if ('experimentalSources' in patch) service?.setExperimentalProviders(experimentalProviders(next.experimentalSources));
      const list = readProfiles();
      setSession((s) => ({ ...s, config: next, profiles: list ?? s.profiles, notice: undefined }));
      return undefined;
    } catch (err) {
      return errorText(err);
    }
  }, [profile, service]);

  const switchTo = useCallback((name: string): string | undefined => {
    if (name === profile) return undefined;
    try {
      const next = loadConfig(name);
      if (!next.connectionString) return `Profile “${name}” has no connection string — remove it and add it again`;
      setActiveProfile(name);
      const list = describeProfiles();
      stampAudit(audit, name, list);
      audit?.log('profile', `switched from ${profile}`);
      setSession({ profile: name, config: next, profiles: list, notice: `✓ Switched to “${name}”` });
      return undefined;
    } catch (err) {
      return errorText(err);
    }
  }, [profile, audit]);

  const add = useCallback(async (name: string, connectionString: string, skipCheck: boolean): Promise<string | undefined> => {
    const fail = (problem: string) => {
      audit?.error('profile', `add ${name}: ${problem}`);
      return problem;
    };
    const nameProblem = profileNameProblem(name, profiles.map((p) => p.name));
    if (nameProblem) return fail(nameProblem);
    const problem = await connectionProblem(connectionString, skipCheck);
    if (problem) return fail(problem);
    try {
      addProfile(name, { connectionString });
      setActiveProfile(name);
      const list = describeProfiles();
      stampAudit(audit, name, list);
      const account = accountLabel(connectionString) ?? 'unknown account';
      audit?.log('profile', `added (${account}${skipCheck ? ', check skipped' : ''}), switched from ${profile}`);
      setSession({ profile: name, config: loadConfig(name), profiles: list, notice: `✓ Added profile “${name}”` });
      return undefined;
    } catch (err) {
      return fail(errorText(err));
    }
  }, [profile, profiles, audit]);

  const rename = useCallback((from: string, to: string): string | undefined => {
    try {
      renameProfile(from, to);
      const list = describeProfiles();
      const active = from === profile ? to : profile;
      stampAudit(audit, active, list);
      audit?.log('profile', `renamed ${from} → ${to}`);
      // The backup folder can get pinned to the old name, so the config is read again.
      const next = from === profile ? loadConfig(to) : undefined;
      setSession((s) => ({ profile: active, config: next ?? s.config, profiles: list }));
      return undefined;
    } catch (err) {
      return errorText(err);
    }
  }, [profile, audit]);

  const remove = useCallback((name: string): string | undefined => {
    if (name === profile) return 'Can’t remove the profile in use — switch to another one first';
    try {
      removeProfile(name);
      const list = describeProfiles();
      audit?.log('profile', `removed ${name}`);
      stampAudit(audit, profile, list);
      setSession((s) => ({ ...s, profiles: list, notice: undefined }));
      return undefined;
    } catch (err) {
      return errorText(err);
    }
  }, [profile, audit]);

  const controls = useMemo<ProfileControls>(
    () => ({ active: profile, profiles, switchTo, add, rename, remove }),
    [profile, profiles, switchTo, add, rename, remove],
  );

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
      const problem = await connectionProblem(connectionString, skipCheck);
      if (problem) return fail(problem);
      const saveError = updateConfig({ connectionString });
      if (saveError) return fail(saveError);
      audit?.log('setup', `connected${skipCheck ? ' (check skipped)' : ''}`);
      return undefined;
    },
    [updateConfig, audit],
  );

  if (!service) {
    return <SetupScreen profile={profiles.length > 1 ? profile : undefined} error={error} onSubmit={connect} />;
  }

  return (
    <App
      key={config.connectionString}
      service={service}
      config={config}
      onConfigChange={updateConfig}
      profiles={controls}
      notice={notice}
      digest={digest}
      summarize={summarize}
      suggestReference={suggestReference}
      audit={audit}
      auditFile={auditFile}
    />
  );
}
