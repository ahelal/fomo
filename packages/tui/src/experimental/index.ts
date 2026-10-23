import { TEAMS_MEETINGS_SOURCE, type ExperimentalProvider } from '@fomo/core';
import { teamsMeetingsProvider } from './teams.js';
import { signInWorkIQ, type WorkIQRun } from './workiq.js';

/** What the TUI needs to run an experimental source (see `EXPERIMENTAL_SOURCE_INFOS` in @fomo/core). */
export interface ExperimentalSetup {
  /** What turning the source on agrees to, shown before ↵ confirms it. */
  consent: string;
  /** Runs before the source is turned on, and again with `l`: accept the terms, sign in. */
  signIn(onLine: (line: string) => void): Promise<WorkIQRun>;
  /** The provider `fetch` runs while the source is on, reused for this process. */
  provider(): ExperimentalProvider;
}

export type ExperimentalSetups = Readonly<Record<string, ExperimentalSetup>>;

let teams: ExperimentalProvider | undefined;

export const EXPERIMENTAL_SETUPS: ExperimentalSetups = {
  [TEAMS_MEETINGS_SOURCE]: {
    consent: 'accept the WorkIQ EULA and sign in to Microsoft 365 with your work account',
    signIn: signInWorkIQ,
    provider: () => (teams ??= teamsMeetingsProvider()),
  },
};

/** The providers of the experimental sources a profile turned on. */
export function experimentalProviders(ids: readonly string[] | undefined, setups: ExperimentalSetups = EXPERIMENTAL_SETUPS): ExperimentalProvider[] {
  return (ids ?? []).flatMap((id) => {
    const setup = setups[id];
    return setup ? [setup.provider()] : [];
  });
}
