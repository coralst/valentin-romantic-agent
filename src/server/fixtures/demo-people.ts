import type { Person } from '../../shared/interfaces/person';

/**
 * Her people, for the demo profile.
 *
 * Server-side, and seeded into DynamoDB alongside the preferences. This used to
 * live under `src/client/fixtures/` and be written straight into
 * `use-people-store`'s own `localStorage` key, which meant the family tree — the
 * largest card on the board — was the one part of a fully-seeded Samantha that
 * did not survive opening the app on another machine.
 *
 * All four generations are filled, because the tree draws four and a seed that
 * filled three would still misrepresent it. The unnamed relatives are
 * deliberate: a gap is drawn dashed and is the state the feature was built for
 * ("her brother, whose name I have never caught"), so the demo should show two.
 *
 * EXTENDED FAMILY, NOT JUST THE HOUSEHOLD — grandmother, uncle, aunt, cousin,
 * nephew. `relationship` is free text, so this needs no new structure: an uncle is
 * an `elder` whose relationship reads "Her uncle". It is a seeding decision, and
 * the reason it matters is that a tree of four people is a list with extra lines
 * through it. Thirteen across four generations is where the drawing starts doing
 * work a list cannot: you can see that her mother's side is the crowded one, that
 * Yosef is the uncle whose birthday is next, and that there are two people on the
 * peer row whose names nobody has ever told me.
 *
 * Birthdays are given for eight of the thirteen. Filling all of them would leave
 * the "no date yet" state in both `FamilyTree`'s chips and the birthday list
 * unexercised, and the point of that card is that remembering theirs lands harder
 * than remembering hers.
 *
 * Ids are fixed strings rather than generated. A seeded person is written to a
 * real key, so a re-seed of the same session must overwrite the row it wrote last
 * time instead of laying down a second Ruth beside the first.
 */
export const DEMO_PEOPLE: readonly Omit<Person, 'updatedAt'>[] = [
  {
    id: 'demo-person-ruth',
    name: 'Ruth',
    relationship: 'Her mother',
    generation: 'elder',
    birthday: '1962-11-09',
    note: 'Goes by Ruthie. Calls on Sundays.',
    source: 'manual',
  },
  {
    id: 'demo-person-daniel',
    name: 'Daniel',
    relationship: 'Her father',
    generation: 'elder',
    birthday: '1958-04-02',
    note: 'Retired. Impossible to buy for; wants tools he already owns.',
    source: 'manual',
  },
  {
    id: 'demo-person-miriam',
    // The only person on the top rung. Her own row rather than folded in with
    // Ruth and Daniel: a grandmother drawn level with her daughter reads as a
    // sibling, which is the one thing a family tree must not say.
    name: 'Miriam',
    relationship: 'Her grandmother',
    generation: 'grandparent',
    birthday: '1934-01-17',
    note: "Ruth's mother. Ninety-two and still hosts.",
    source: 'manual',
  },
  {
    id: 'demo-person-yosef',
    name: 'Yosef',
    relationship: 'Her uncle',
    generation: 'elder',
    birthday: '1966-09-12',
    note: "Ruth's younger brother. The one who tells the same three stories.",
    source: 'manual',
  },
  {
    id: 'demo-person-dahlia',
    name: 'Dahlia',
    relationship: 'Her aunt',
    generation: 'elder',
    // Undated on purpose: married in, so nobody in the family volunteers it.
    birthday: null,
    note: "Yosef's wife. Sends things she made herself.",
    source: 'manual',
  },
  {
    id: 'demo-person-uncle-fathers-side',
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
    id: 'demo-person-nadia',
    name: 'Nadia',
    relationship: 'Older sister',
    generation: 'peer',
    birthday: '1991-03-22',
    note: 'The one she tells things to first.',
    source: 'manual',
  },
  {
    id: 'demo-person-tom',
    // Named but undated: he belongs on the tree and not on the birthday list.
    name: 'Tom',
    relationship: 'Her closest friend',
    generation: 'peer',
    birthday: null,
    note: 'From university. Knows every story already.',
    source: 'manual',
  },
  {
    id: 'demo-person-nadias-husband',
    // A gap on purpose — drawn dashed, and the card offers to ask about him.
    name: null,
    relationship: "Nadia's husband",
    generation: 'peer',
    birthday: null,
    note: null,
    source: 'manual',
  },
  {
    id: 'demo-person-lena',
    name: 'Lena',
    relationship: 'Her cousin',
    generation: 'peer',
    birthday: '1993-06-30',
    note: "Yosef and Dahlia's daughter. Grew up two streets away.",
    source: 'manual',
  },
  {
    id: 'demo-person-ari',
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
    id: 'demo-person-talia',
    name: 'Talia',
    relationship: 'Her niece',
    generation: 'younger',
    birthday: '2021-09-24',
    note: "Nadia's youngest.",
    source: 'manual',
  },
  {
    id: 'demo-person-ruben',
    name: 'Ruben',
    relationship: 'Her younger cousin',
    generation: 'younger',
    birthday: null,
    note: 'At university. She sends him money and denies it.',
    source: 'manual',
  },
];
