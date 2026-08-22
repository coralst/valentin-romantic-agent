import { describe, it, expect } from 'vitest';
import { portraitForPartner } from '../persona-portrait';
import { DEMO_PROFILE_PREFERENCES } from '../../../server/fixtures/demo-profile';

/**
 * The seam that couples the shipped drawing to the persona fixture.
 *
 * The lookup is by name because the client is never told which persona was
 * seeded (one Cognito account backs all of them). That works only as long as the
 * fixture's name and the table's key agree, and nothing in the type system says
 * they must — so this file says it instead.
 */
describe('portraitForPartner', () => {
  const fixtureName = DEMO_PROFILE_PREFERENCES.find(
    (pref) => pref.key === 'name',
  )?.value;

  it('has a portrait for the name the demo fixture seeds', () => {
    expect(fixtureName).toBeTruthy();
    expect(portraitForPartner(fixtureName!)).toBe('/samantha-portrait.svg');
  });

  it('points at a file the build actually serves', () => {
    // Root-relative, so it resolves from the served origin rather than from
    // whichever route the SPA happens to be on.
    expect(portraitForPartner(fixtureName!)).toMatch(/^\/[\w-]+\.svg$/);
  });

  it('gives a fresh profile nothing, so it keeps its monogram', () => {
    expect(portraitForPartner(null)).toBeNull();
    expect(portraitForPartner(undefined)).toBeNull();
    expect(portraitForPartner('')).toBeNull();
  });

  it('gives an unknown partner nothing rather than someone else’s face', () => {
    expect(portraitForPartner('Coral')).toBeNull();
    expect(portraitForPartner('Samantha Jones')).toBeNull();
  });

  it('ignores case and stray whitespace, which is how names arrive', () => {
    expect(portraitForPartner('  samantha ')).toBe('/samantha-portrait.svg');
    expect(portraitForPartner('SAMANTHA')).toBe('/samantha-portrait.svg');
  });
});
