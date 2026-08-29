/**
 * Does this preference carry the partner's name?
 *
 * Mirrors the `partner_name` entry in the client's PROFILE_FIELD_REGISTRY. The
 * registry itself is client-only and pulls in display concerns (labels, sections,
 * ordering), so this restates the one mapping the server needs rather than
 * dragging that module across the boundary. Keep the two in step.
 *
 * Used by both the extractor, which denormalises the name onto the session as
 * conversation reveals it, and the demo seed, which knows it up front.
 */
export function isPartnerNamePreference(category: string, key: string): boolean {
  if (category !== 'personality_traits') return false;
  const normalised = key.trim().toLowerCase();
  /*
   * `partner_name` is the one the extractor itself writes, and it was missing.
   *
   * When the model identifies a profile field, `preference-extractor` sets the row's
   * key *to the field id* — deliberately, so the same fact restated in different
   * words updates one row rather than accumulating near-duplicates. So every
   * extraction-derived name arrives here as `partner_name`, matched neither of the
   * two spellings below, and the denormalised `session.partnerName` was silently
   * never written: the sidebar fell back to "New conversation" for any conversation
   * where the name had been *learned* rather than seeded.
   */
  return (
    normalised === 'partner_name' || normalised === 'name' || normalised === 'partner name'
  );
}
