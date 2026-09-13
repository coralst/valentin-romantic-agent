import type { ToolContext } from './tool-registry';
import { NOTIFY_EMAIL_FIELD, resolveNotifyEmail } from '../reminders/notify-email';
import { profileFieldValue } from '../reminders/reminder-sync';

/**
 * Where to write to a user, resolved from inside a tool.
 *
 * ## Why this is not in `notify-email.ts`
 *
 * That file owns the *rule* — profile address beats the deployment owner, and an
 * unusable value on either side counts as no value. This file owns the *lookup*:
 * two reads against the session's store, then that rule. They are separated because
 * the lookup needs `profileFieldValue` from `reminder-sync.ts`, and `reminder-sync`
 * already imports `notify-email` — putting this there would close an import cycle.
 *
 * ## Why it swallows its own failures
 *
 * A throttled table must cost the *specific* address and fall back to the owner's,
 * never the offer to send. `resolveNotifyEmail` answers with the deployment owner
 * when handed nothing, so every failure here lands on the behaviour a deployment
 * with no store on the tool path already has. Returning null means there is no
 * usable address anywhere, which is a different and reportable state.
 */
export async function notifyAddressForTool(ctx: ToolContext): Promise<string | null> {
  if (!ctx.storage) return resolveNotifyEmail(null);

  try {
    const [preferences, manual] = await Promise.all([
      ctx.storage.getPreferencesBySession(ctx.sessionId),
      ctx.storage.getManualValues(ctx.sessionId),
    ]);
    return resolveNotifyEmail(profileFieldValue(NOTIFY_EMAIL_FIELD, manual, preferences));
  } catch {
    return resolveNotifyEmail(null);
  }
}
