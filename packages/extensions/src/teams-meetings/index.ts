import type { ExtensionContext } from '@fomo/core/extension-api';
import { teamsMeetingsProvider } from './meetings.js';
import { workiqClient } from './workiq.js';
export { mergeMeeting as merge } from './meetings.js';

export async function fetch(ctx: ExtensionContext) {
  const provider = teamsMeetingsProvider({
    connect: async () => workiqClient(ctx),
    state: await ctx.state.get('meetings'),
  });
  const items = await provider.fetch(ctx.signal);
  await ctx.state.set('meetings', provider.snapshot());
  return items;
}
