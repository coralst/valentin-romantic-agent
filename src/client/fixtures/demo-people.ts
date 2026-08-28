import type { Person } from '../../shared/interfaces/person';

/**
 * Her people, for the demo profile.
 *
 * Client-side rather than in `demo-profile.ts` because people are not profile
 * fields: they live in `use-people-store`'s own per-session `localStorage` key
 * and never reach the server. Seeding them alongside the preferences is the only
 * way the demo path can populate `FamilyTree` and `TheirBirthdays`, which
 * otherwise sat at "nobody yet" even at 21 of 21 known — the family tree is the
 * most diagram-like card on the board and it could never be shown.
 *
 * All three generations are filled, because the tree draws three and a seed that
 * filled only one would still misrepresent it. The unnamed brother-in-law is
 * deliberate: a gap is drawn dashed and is the state the feature was built for
 * ("her brother, whose name I have never caught"), so the demo should show one.
 *
 * EXTENDED FAMILY, NOT JUST THE HOUSEHOLD — grandmother, uncle, aunt, cousin,
 * nephew. `relationship` is free text, so this needs no new structure: an uncle is
 * an `elder` whose relationship reads "Her uncle". It is a seeding decision, and
 * the reason it matters is that a tree of four people is a list with extra lines
 * through it. Thirteen across three generations is where the drawing starts doing
 * work a list cannot: you can see that her mother's side is the crowded one, that
 * Yosef is the uncle whose birthday is next, and that there are two people on the
 * peer row whose names nobody has ever told me.
 *
 * Birthdays are given for eight of the thirteen. Filling all of them would leave
 * the "no date yet" state in both `FamilyTree`'s chips and `TheirBirthdays`
 * unexercised, and the point of that card is that remembering theirs lands harder
 * than remembering hers.
 */
export const DEMO_PEOPLE: readonly Omit<Person, 'id' | 'updatedAt'>[] = [
  {
    name: 'Ruth',
    relationship: 'Her mother',
    generation: 'elder',
    birthday: '1962-11-09',
    note: 'Goes by Ruthie. Calls on Sundays.',
    source: 'manual',
  },
  {
    name: 'Daniel',
    relationship: 'Her father',
    generation: 'elder',
    birthday: '1958-04-02',
    note: 'Retired. Impossible to buy for; wants tools he already owns.',
    source: 'manual',
  },
  {
    // The oldest person on the tree, and the reason the elder row is the crowded
    // one — which is a thing you can only see in a drawing.
    name: 'Miriam',
    relationship: 'Her grandmother',
    generation: 'elder',
    birthday: '1934-01-17',
    note: "Ruth's mother. Ninety-two and still hosts.",
    source: 'manual',
  },
  {
    name: 'Yosef',
    relationship: 'Her uncle',
    generation: 'elder',
    birthday: '1966-09-12',
    note: "Ruth's younger brother. The one who tells the same three stories.",
    source: 'manual',
  },
  {
    name: 'Dahlia',
    relationship: 'Her aunt',
    generation: 'elder',
    // Undated on purpose: married in, so nobody in the family volunteers it.
    birthday: null,
    note: "Yosef's wife. Sends things she made herself.",
    source: 'manual',
  },
  {
    // A second gap, on the elder row this time. One gap reads as an oversight; two
    // read as the honest state of anyone's knowledge of their partner's family.
    name: null,
    relationship: "Her uncle on her father's side",
    generation: 'elder',
    birthday: null,
    note: 'Lives abroad. Comes up at weddings.',
    source: 'manual',
  },
  {
    name: 'Nadia',
    relationship: 'Older sister',
    generation: 'peer',
    birthday: '1991-03-22',
    note: 'The one she tells things to first.',
    source: 'manual',
  },
  {
    // Named but undated: he belongs on the tree and not on the birthday list.
    name: 'Tom',
    relationship: 'Her closest friend',
    generation: 'peer',
    birthday: null,
    note: 'From university. Knows every story already.',
    source: 'manual',
  },
  {
    // A gap on purpose — drawn dashed, and the card offers to ask about him.
    name: null,
    relationship: "Nadia's husband",
    generation: 'peer',
    birthday: null,
    note: null,
    source: 'manual',
  },
  {
    name: 'Lena',
    relationship: 'Her cousin',
    generation: 'peer',
    birthday: '1993-06-30',
    note: "Yosef and Dahlia's daughter. Grew up two streets away.",
    source: 'manual',
  },
  {
    // The younger row: without it the tree draws an empty third generation, which
    // is a correct empty state but not the one worth demonstrating.
    name: 'Ari',
    relationship: 'Her nephew',
    generation: 'younger',
    birthday: '2018-12-05',
    note: "Nadia's eldest. Currently only interested in trains.",
    source: 'manual',
  },
  {
    name: 'Talia',
    relationship: 'Her niece',
    generation: 'younger',
    birthday: '2021-09-24',
    note: "Nadia's youngest.",
    source: 'manual',
  },
  {
    name: 'Ruben',
    relationship: 'Her younger cousin',
    generation: 'younger',
    birthday: null,
    note: 'At university. She sends him money and denies it.',
    source: 'manual',
  },
];
