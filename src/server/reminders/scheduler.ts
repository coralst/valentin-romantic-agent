import type {
  ReminderIndexReader,
  ScopedStorageFactory,
} from '../persistence/storage-interface';
import { logger } from '../logging';
import { dispatchDue } from './dispatcher';
import type { ReminderSender } from './sender';
import { reminderContextFor } from './suggestions';

/**
 * The in-process sweeper that makes reminders actually happen.
 *
 * ## Why a timer in the server and not a scheduled Lambda
 *
 * The row already lives in the table this task owns and `markSent` is a conditional
 * write, so correctness does not depend on there being exactly one sweeper — see
 * `dispatcher.ts`. That removes the only real argument for a separate compute:
 * running it here needs no new IAM principal, no second deployment artefact, and no
 * way for the schedule and the code to be at different versions. It also means the
 * whole path is exercised by `npm test` against the in-memory store.
 *
 * The cost is that reminders stop while no task is running. For a build whose lead
 * times are measured in days and whose ECS service keeps one task up, that is an
 * acceptable trade and a visible one.
 */

export interface ReminderSchedulerOptions {
  reader: ReminderIndexReader;
  sender: ReminderSender;
  /** How often to sweep. A minute is plenty — `dueAt` is a whole hour of the day. */
  intervalMs: number;
  /** Where the app lives, for the resume link in the mail. */
  origin?: string;
  /** Rows per sweep. Defaults to the dispatcher's own bound. */
  limit?: number;
  /**
   * The scoped store, so a reminder can be composed from the profile it belongs to.
   *
   * The scheduler is the right place for this and the dispatcher is not: this is
   * already the layer that owns process-wide wiring, and scoping per row here means
   * `dispatchDue` keeps taking only the cross-tenant index it needs. Each row is read
   * through `forUser(reminder.userId)`, so the composer sees exactly one user's
   * answers — the same scoping a chat turn gets.
   *
   * Absent ⇒ reminders still send, carrying the date and the link but no suggestions.
   */
  storeFactory?: ScopedStorageFactory;
}

export interface ReminderScheduler {
  /** Cancel the timer. Idempotent; an in-flight sweep still finishes. */
  stop(): void;
}

export function startReminderScheduler(options: ReminderSchedulerOptions): ReminderScheduler {
  const { reader, sender, intervalMs, origin, limit, storeFactory } = options;

  /*
   * Scoped per row, not per sweep: `dueBefore` crosses users by design, so the store
   * handle has to be built from the row in hand. `reminderContextFor` swallows its own
   * failures, which is what lets this sit on the send path at all.
   */
  const context = storeFactory
    ? (reminder: Parameters<typeof reminderContextFor>[1]) =>
        reminderContextFor(storeFactory.forUser(reminder.userId), reminder)
    : undefined;

  /*
   * Overlap guard.
   *
   * A sweep that outlives its interval — a slow channel, a throttled table — would
   * otherwise have a second sweep start on top of it, reading the same rows. The
   * claim makes that harmless rather than duplicating mail, but it also makes it
   * pointless, and under sustained slowness the sweeps pile up until the task runs
   * out of sockets.
   */
  let inFlight = false;

  const sweep = async (): Promise<void> => {
    if (inFlight) return;
    inFlight = true;
    try {
      const summary = await dispatchDue(reader, sender, new Date(), { origin, limit, context });
      // Only when it did something: at one line a minute an idle sweeper would bury
      // every other event in the log, and the sweep that mattered with it.
      if (summary.considered > 0) logger.info('reminder.sweep', { ...summary });
    } catch (error) {
      /*
       * Nothing may escape this.
       *
       * An unhandled rejection inside a timer callback terminates the Node process
       * under its default policy, so a single malformed reminder row would take the
       * whole conversation service down with it. The sweeper is the least important
       * thing in the task and must not be able to be the fatal one.
       */
      logger.error('reminder.sweep_failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      inFlight = false;
    }
  };

  const timer = setInterval(() => void sweep(), intervalMs);
  // Never a reason to hold the process open: a pending sweep must not keep `npm
  // test` hanging or delay a shutdown that is already draining connections.
  timer.unref();

  logger.info('reminder.scheduler_started', { intervalMs, channel: sender.channel });

  return {
    stop() {
      clearInterval(timer);
    },
  };
}
