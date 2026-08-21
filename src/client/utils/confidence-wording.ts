/**
 * Turns a numeric preference confidence into the single lowercase word the
 * vitrine chat shows on a "noted" chip (option-5d-brief.html:68, "certain").
 *
 * The mockup writes a word, but `Preference.confidence` is a 0–1 score, so the
 * scale has to be collapsed somewhere. It happens here rather than in the chip
 * so the thresholds are testable on their own and can be reused by any other
 * surface that wants to say the same thing in words.
 *
 * Thresholds match the one that already exists in the app: `ProfileField`
 * treats < 0.5 as "tentative", so that is where `maybe` begins.
 */
export type ConfidenceWord = 'certain' | 'likely' | 'maybe';

export function confidenceWord(confidence: number): ConfidenceWord {
  // NaN and out-of-range values fall back to the most cautious reading rather
  // than asserting certainty the score does not support.
  if (!Number.isFinite(confidence)) return 'maybe';
  if (confidence >= 0.9) return 'certain';
  if (confidence >= 0.5) return 'likely';
  return 'maybe';
}
