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
  return normalised === 'name' || normalised === 'partner name';
}
