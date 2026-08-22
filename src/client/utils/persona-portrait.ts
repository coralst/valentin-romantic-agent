/**
 * The hand-drawn portraits shipped for the demo personas.
 *
 * WHY THIS IS A LOOKUP AND NOT A BRANCH IN A COMPONENT
 *
 * "Samantha has a portrait" is a fact about the persona, not about the avatar
 * widget. `PartnerAvatar` and `WhoHeader` are handed a URL and draw it; neither
 * knows who Samantha is, so neither has to change the day a second persona gets
 * a drawing — the table below is the only thing that grows.
 *
 * KEYED BY NAME, DELIBERATELY
 *
 * The client never learns which persona was seeded: every demo persona shares
 * one Cognito account (see `src/server/fixtures/demo-personas.ts`), so the token
 * cannot say, and the profile store holds preferences rather than a persona id.
 * What it does hold is `partner_name`, which for the seeded persona is exactly
 * the fixture's value. `__tests__/persona-portrait.test.ts` pins the two
 * together, so renaming the fixture breaks a test rather than silently losing
 * her face.
 *
 * The consequence, stated plainly: a real visitor whose partner is also called
 * Samantha gets this illustration until she uploads a photo. That is a
 * placeholder standing in for an unknown face — the same thing the ♥ glyph and
 * the initial do — so it makes no claim that could be wrong.
 */

/**
 * Persona name (lowercased) to portrait asset under `public/`.
 *
 * Root-relative rather than imported: these are hand-authored SVGs served as
 * static files, not modules, and the app is served from the domain root.
 */
const PERSONA_PORTRAITS: Readonly<Record<string, string>> = {
  samantha: '/samantha-portrait.svg',
};

/**
 * The shipped portrait for this partner name, or null when there is none.
 *
 * Total rather than throwing: it is called on every render of the rail header
 * with whatever the profile currently holds, including `null` before a name is
 * known and free text a visitor typed into the field by hand.
 */
export function portraitForPartner(name: string | null | undefined): string | null {
  if (!name) return null;
  return PERSONA_PORTRAITS[name.trim().toLowerCase()] ?? null;
}

/*
 * `public/partner-portrait.svg` is deliberately *not* wired in as a fallback for
 * everyone else. A fresh account keeps the initial-or-♥ cameo it has today: a
 * stranger's drawn face in the slot where your partner's photo goes is a worse
 * blank than a monogram.
 */
