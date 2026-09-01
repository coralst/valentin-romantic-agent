import type { StorageInterface } from './storage-interface';
import { recordStoreRead } from '../telemetry/turn-metrics';

/**
 * Which `StorageInterface` methods are reads.
 *
 * Reads only. A write is not interesting to the comparison — both engines write the
 * same things — and counting writes would bury the number the panel is about.
 *
 * Held as data rather than as eight hand-written delegations so that adding a read
 * to `StorageInterface` cannot silently stop being counted... except by omission
 * from this list, which is what `counting-store.test.ts` exists to catch: it asserts
 * every name here exists on a real store, so a rename breaks the test rather than
 * quietly zeroing a tile.
 */
export const READ_METHODS: readonly string[] = [
  'getPreferencesBySession',
  'findPreference',
  'getPeopleBySession',
  'getTasksBySession',
  'getManualValues',
  'getMessagesBySession',
  'getSession',
  'listSessions',
];

const READ_METHOD_SET = new Set(READ_METHODS);

/**
 * Wrap a store so its reads are counted against the turn in progress.
 *
 * Transparent when no turn is in scope — `recordStoreRead` is a no-op outside
 * `withTurn`, so tests, `POST /api/session/seed` and boot-time reads are unaffected.
 *
 * MUST be applied to both engines' stores identically. The whole comparison rests on
 * `agentcore-orchestrator.ts`'s contract that the two engines differ only in the
 * engine; wrapping one and not the other would make this counter the confound
 * instead of the measurement. It is applied once, in `defaultStoreFactory`, for that
 * reason.
 *
 * A `Proxy` rather than a class with eight delegating methods: the delegations would
 * be eight chances to typo a signature, and `StorageInterface` has twenty-odd methods
 * that would all need forwarding for the sake of counting eight.
 */
export function countingStore(inner: StorageInterface): StorageInterface {
  return new Proxy(inner, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);

      if (typeof value !== 'function' || typeof property !== 'string') return value;
      if (!READ_METHOD_SET.has(property)) return value;

      return (...args: unknown[]) => {
        // Counted on call, not on resolve. A read that was issued cost a round trip
        // whether or not it came back, and counting on resolve would drop exactly the
        // failures worth seeing.
        recordStoreRead();
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  }) as StorageInterface;
}
