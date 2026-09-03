/**
 * The demo profiles a visitor can choose between on the landing page.
 *
 * There is exactly one shared Cognito demo account. Adding a second persona by
 * adding a second account would mean a second password in Secrets Manager, a
 * second app client, and a second thing to rotate — all to show a different set
 * of fixture rows. So the *seed* is parameterised and the credential is not: a
 * persona is nothing more than a named bundle of preferences to write into a
 * fresh session.
 *
 * The personas are fictional. No real person, and no identifying detail.
 */

import type { Person } from '../../shared/interfaces/person';
import type { ExtractedPreference } from '../persistence/storage-interface';
import { DEMO_PROFILE_PREFERENCES } from './demo-profile';
import { DEMO_PEOPLE } from './demo-people';
import { DEMO_TASKS } from './demo-tasks';
import { DEMO_OUTINGS } from './demo-outings';
import type { DemoOuting } from './demo-outings';
import type { DemoTask } from './demo-tasks';
import { SAMANTHA_HISTORY } from './demo-history';
import type { DemoConversation } from './demo-history';

export type { DemoConversation, DemoTranscriptTurn } from './demo-history';

/**
 * Spelled out rather than derived from the list below.
 *
 * Deriving it would make the list's declaration circular with the `DemoPersona`
 * annotation that keeps the list honest. Two personas is not a maintenance
 * problem, and the union is what turns a mistyped id in a caller into a compile
 * error instead of a silent fallback to Samantha.
 */
export type DemoPersonaId = 'samantha' | 'fresh';

/** A selectable demo profile */
export interface DemoPersona {
  id: DemoPersonaId;
  /**
   * The *partner* this persona is about — Valentin's subject, not his user.
   *
   * Shown on the landing page button, and nowhere that names the signed-in
   * person: "Signed in as Samantha" was exactly that mix-up, and it read as the
   * app having confused the user with their spouse.
   */
  name: string;
  /**
   * The person who is signed in when this persona is loaded.
   *
   * Separate from `name` because the demo is *his* account: he is the one
   * talking to Valentin about her. This is the only string the account chip may
   * use. It matches the address the login form is prefilled with
   * (`LoginScreen.tsx`'s `PREFILLED_EMAIL`), so the audience sees one identity
   * from the front door onwards.
   */
  userName: string;
  /** One line of landing-page copy explaining what this persona demonstrates */
  blurb: string;
  /** Seeded into the session the demo login creates */
  preferences: readonly ExtractedPreference[];
  /**
   * Her family, seeded alongside the preferences.
   *
   * A separate list rather than more preferences because a family is a set of
   * records and the registry holds twenty-one single-valued fields — see
   * `shared/interfaces/person.ts`. Optional, so "start fresh" stays empty
   * without having to spell out an empty tree.
   */
  people?: readonly Omit<Person, 'updatedAt'>[];
  /** What he has to do next. Dues are resolved against the seed moment. */
  tasks?: readonly DemoTask[];
  /**
   * Where he has already taken her, two of them rated.
   *
   * Seeded rather than left to the demo to produce, because the only thing that
   * writes an outing is a confirmed booking — so the history card and the survey
   * on it would both demo as empty boxes until someone booked a restaurant live
   * on stage.
   */
  outings?: readonly DemoOuting[];
  /**
   * Backdated conversations to seed alongside the preferences, oldest first.
   *
   * Absent — not empty — for a persona with no past, so "this persona has no
   * history" and "this persona has an empty history" cannot drift apart.
   *
   * The *last* entry is the conversation the seed returns and the one that
   * carries `preferences`; everything before it becomes a read-only row in the
   * sidebar. Ordering is the fixture's job rather than the seeder's, so the file
   * reads in the order a presenter would scroll it.
   */
  history?: readonly DemoConversation[];
}

export const DEMO_PERSONAS: readonly DemoPersona[] = [
  {
    id: 'samantha',
    name: 'Samantha',
    userName: 'Ralf',
    blurb: 'Three years together. He remembers all of it.',
    preferences: DEMO_PROFILE_PREFERENCES,
    people: DEMO_PEOPLE,
    tasks: DEMO_TASKS,
    outings: DEMO_OUTINGS,
    history: SAMANTHA_HISTORY,
  },
  {
    id: 'fresh',
    name: 'Start fresh',
    // Nobody in particular: this is the "Create an Account" door, so there is no
    // backstory to borrow a first name from.
    userName: 'Guest',
    blurb: 'An empty profile — Valentin asks about your partner from scratch.',
    preferences: [],
  },
];

/**
 * The persona used when a caller names none.
 *
 * `POST /api/demo/login` shipped before personas existed and its callers send no
 * body at all; they must keep landing on the populated profile.
 */
export const DEFAULT_PERSONA_ID: DemoPersonaId = 'samantha';

// Looked up rather than indexed, so reordering the list above cannot silently
// change which persona a body-less login lands on.
const DEFAULT_PERSONA: DemoPersona =
  DEMO_PERSONAS.find((persona) => persona.id === DEFAULT_PERSONA_ID) ??
  DEMO_PERSONAS[0];

/**
 * Resolve a persona id, falling back to the default.
 *
 * Deliberately total rather than throwing: the id arrives in the body of an
 * *unauthenticated* endpoint, so an unknown value is an ordinary thing for a
 * stranger to send. Turning that into a 500 would hand anyone a trivial way to
 * fill the error logs, and there is nothing to fail about — a demo has a
 * perfectly good default to show them.
 */
export function resolvePersona(id: unknown): DemoPersona {
  const match =
    typeof id === 'string'
      ? DEMO_PERSONAS.find((persona) => persona.id === id)
      : undefined;
  return match ?? DEFAULT_PERSONA;
}

/**
 * The personas as `GET /api/config` advertises them.
 *
 * Counts only. That endpoint is the one route reachable before sign-in, so the
 * preference *values* stay behind the token even though this particular fixture
 * is synthetic — the shape of the response should not have to be re-audited the
 * day someone seeds a persona from something real.
 */
export function describePersonas(): {
  id: DemoPersonaId;
  name: string;
  userName: string;
  blurb: string;
  fieldCount: number;
}[] {
  return DEMO_PERSONAS.map(({ id, name, userName, blurb, preferences }) => ({
    id,
    name,
    userName,
    blurb,
    fieldCount: preferences.length,
  }));
}
