import { TEAMS_MEETINGS_SOURCE, type ExperimentalProvider } from '@fomo/core';
import { ExtensionHost } from '../extensions/host.js';
import { signInWorkIQ, type WorkIQRun } from './workiq.js';

/** What the TUI needs to run an experimental source (see `EXPERIMENTAL_SOURCE_INFOS` in @fomo/core). */
export interface ExperimentalSetup {
  /** What turning the source on agrees to, shown before ↵ confirms it. */
  consent: string;
  /** The trust boundary used by this provider. */
  isolation?: 'sandboxed' | 'unsandboxed';
  /**
   * Runs before the source is turned on, and again with `l`: accept the terms, sign in. Aborting `signal`
   * cancels it (stops the sign-in process).
   */
  signIn(onLine: (line: string) => void, signal?: AbortSignal): Promise<WorkIQRun>;
  /** The provider `fetch` runs while the source is on, reused for this process. */
  provider(): ExperimentalProvider;
}

export type ExperimentalSetups = Readonly<Record<string, ExperimentalSetup>>;

export function experimentalSetups(host: ExtensionHost): ExperimentalSetups {
  return {
    [TEAMS_MEETINGS_SOURCE]: {
      isolation: 'unsandboxed',
      consent: 'UNSANDBOXED: WorkIQ uses the host account and host filesystem/network; FOMO blocks writes, constrains Graph calls, and uses read-only OneDrive/SharePoint search for recordings',
      signIn: (onLine, signal) => {
        host.revokeTeamsInvocations('Stopped: signing in again');
        return signInWorkIQ(onLine, host.profile, signal ? AbortSignal.any([host.signal, signal]) : host.signal);
      },
      provider: () => host.teamsProvider(),
    },
  };
}

export const EXPERIMENTAL_SETUPS = experimentalSetups(new ExtensionHost('default'));

/** The providers of the experimental sources a profile turned on. */
export function experimentalProviders(ids: readonly string[] | undefined, setups: ExperimentalSetups = EXPERIMENTAL_SETUPS): ExperimentalProvider[] {
  return (ids ?? []).flatMap((id) => {
    const setup = setups[id];
    return setup ? [setup.provider()] : [];
  });
}
