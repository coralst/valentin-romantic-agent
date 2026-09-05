/**
 * The provider marks drawn on the integrations panel.
 *
 * The panel used to carry emoji — 💐 for the florist row, ✉️ for Messages — which
 * was the right choice while the rows were named for capabilities rather than for
 * the services behind them. Now that every row names its provider, a generic glyph
 * beside "Gmail" is a worse label than no glyph at all: the one thing the icon can
 * usefully say is *which* account is about to be reached, and only the provider's
 * own colour says that at a glance.
 *
 * These are hand-drawn marks in each provider's brand colour, not copies of the
 * official logo files, and that is deliberate rather than lazy:
 *
 * - No dependency and no network. An icon set would be ~1MB of paths for eight
 *   glyphs, and a CDN reference would make this panel fail to render offline —
 *   including in the Playwright run, which has no outbound network for assets.
 * - Nothing here is passed off as a trademark asset. A cyan tile with a W is
 *   plainly our drawing of "this row reaches Wolt"; a pixel copy of Wolt's logo
 *   would imply Wolt endorsed the app, which is exactly the claim the catalogue's
 *   header comment has always refused to make.
 *
 * If a provider ever supplies a licensed asset, replace one entry here and no
 * caller changes: the panel asks for a mark by id and never for a path.
 */

import type { ReactNode } from 'react';
import { colors, radii, typography } from './tokens';

/**
 * The marks that exist, which is one per catalogue row.
 *
 * Every id but `spotify` is also an `IntegrationId`, and that is not a
 * coincidence — the catalogue is now one row per provider. `spotify` is here
 * without a server counterpart because the Spotify row is still unbuilt, and a
 * row badged "not built yet" still has to be recognisable.
 */
export type BrandMarkId =
  | 'ontopo'
  | 'google-calendar'
  | 'google-places'
  | 'wolt'
  | 'spotify'
  | 'amadeus'
  | 'gmail'
  | 'whatsapp'
  | 'hebcal'
  | 'web-search';

/** A monogram tile, for providers whose logo is a wordmark rather than a symbol. */
function monogram(letter: string, fill: string, rounded: 'square' | 'circle'): ReactNode {
  return (
    <>
      {rounded === 'circle' ? (
        <circle cx="12" cy="12" r="10.5" fill={fill} />
      ) : (
        <rect x="2" y="2" width="20" height="20" rx="5.5" fill={fill} />
      )}
      <text
        x="12"
        y="16.6"
        textAnchor="middle"
        fontSize="12.5"
        fontWeight="700"
        fill="#ffffff"
        fontFamily="Helvetica, Arial, sans-serif"
      >
        {letter}
      </text>
    </>
  );
}

const MARKS: Record<BrandMarkId, ReactNode> = {
  // Ontopo's own mark is a wordmark on near-black, so a monogram in the same ink
  // is the closest honest reduction.
  ontopo: monogram('O', '#22252B', 'circle'),

  // A dated leaf: the one feature of Google Calendar's icon that survives being
  // drawn at 30px is the number in the white square.
  'google-calendar': (
    <>
      <rect x="3" y="3.5" width="18" height="17" rx="2.6" fill="#ffffff" stroke="#1A73E8" strokeWidth="1.7" />
      <path d="M3 8.4h18" stroke="#1A73E8" strokeWidth="1.7" />
      <text
        x="12"
        y="17.8"
        textAnchor="middle"
        fontSize="8.6"
        fontWeight="700"
        fill="#1A73E8"
        fontFamily="Helvetica, Arial, sans-serif"
      >
        31
      </text>
    </>
  ),

  // A map pin, which is the one shape Google Maps Platform is recognisable by at
  // 30px — the four-colour logo is not, and redrawing it would be a trademark
  // asset rather than our own reduction.
  'google-places': (
    <>
      <path
        d="M12 2.8c-3.5 0-6.3 2.8-6.3 6.3 0 4.4 6.3 11.9 6.3 11.9s6.3-7.5 6.3-11.9c0-3.5-2.8-6.3-6.3-6.3z"
        fill="#EA4335"
      />
      <circle cx="12" cy="9.1" r="2.4" fill="#ffffff" />
    </>
  ),

  wolt: monogram('W', '#00C2E8', 'square'),

  // The three arcs are the whole of Spotify's mark, and they read correctly even
  // at this size.
  spotify: (
    <>
      <circle cx="12" cy="12" r="10.5" fill="#1DB954" />
      <path d="M6.9 9.3c3.3-1 6.9-.6 9.9 1" stroke="#ffffff" strokeWidth="1.9" strokeLinecap="round" fill="none" />
      <path d="M7.7 12.5c2.7-.8 5.6-.4 8 .9" stroke="#ffffff" strokeWidth="1.7" strokeLinecap="round" fill="none" />
      <path d="M8.5 15.5c2.1-.6 4.3-.3 6.2.7" stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    </>
  ),

  amadeus: monogram('a', '#005EB8', 'circle'),

  // The envelope whose fold makes an M, in Gmail's red on white.
  gmail: (
    <>
      <rect x="1.6" y="5" width="20.8" height="14" rx="2.4" fill="#ffffff" stroke="#EA4335" strokeWidth="1.6" />
      <path
        d="M2.8 6.4 12 13.4l9.2-7"
        fill="none"
        stroke="#EA4335"
        strokeWidth="2.2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </>
  ),

  // Handset in a green disc. Not the tailed bubble — a tail this small closes up
  // into a blob and stops reading as WhatsApp at all.
  whatsapp: (
    <>
      <circle cx="12" cy="12" r="10.5" fill="#25D366" />
      <path
        d="M8.7 7.3c.55-.22 1.16.03 1.4.57l.6 1.4c.2.45.09.98-.27 1.31l-.36.33a7.1 7.1 0 0 0 2.29 2.29l.33-.36c.33-.36.86-.47 1.31-.27l1.4.6c.54.24.79.85.57 1.4-.33.83-1.17 1.36-2.06 1.28-3.1-.28-5.57-2.75-5.85-5.85-.08-.89.45-1.73 1.28-2.06Z"
        fill="#ffffff"
      />
    </>
  ),

  // Not a company logo: Hebcal is a calendar API, and the thing the row is
  // actually for is knowing when Shabbat comes in. So, a candle, in our own ink.
  /*
   * A calendar carrying a small Magen David, rather than the candle this used to
   * be. Hebcal supplies *dates* — candle-lighting times among them, but also
   * holidays and the Hebrew date — and a candle read as "Shabbat" specifically,
   * which is narrower than what the service does. The calendar says the category
   * and the star says whose.
   */
  hebcal: (
    <g
      stroke={colors.claret}
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    >
      <rect x="3" y="5" width="18" height="16" rx="2.5" />
      <path d="M3 9.5h18M8 3v3.5M16 3v3.5" />
      {/* Two overlaid triangles: at 17px the outline reads, a filled star does not. */}
      <path d="M12 11.4l2.6 4.5h-5.2z" strokeWidth="1.2" />
      <path d="M12 18.6l2.6-4.5h-5.2z" strokeWidth="1.2" />
    </g>
  ),

  // Not a company logo either: the row is the open web, not any one engine —
  // Tavily and DuckDuckGo are interchangeable behind it. So, a globe with a
  // magnifier, in our own ink.
  'web-search': (
    <>
      <circle cx="10.5" cy="10.5" r="7" fill="none" stroke={colors.claret} strokeWidth="1.7" />
      <path d="M3.5 10.5h14" stroke={colors.claret} strokeWidth="1.3" />
      <path
        d="M10.5 3.5c-2.2 1.9-3.3 4.3-3.3 7s1.1 5.1 3.3 7c2.2-1.9 3.3-4.3 3.3-7s-1.1-5.1-3.3-7Z"
        fill="none"
        stroke={colors.claret}
        strokeWidth="1.3"
      />
      <path d="m15.7 15.7 4.6 4.6" stroke={colors.claret} strokeWidth="2.2" strokeLinecap="round" />
    </>
  ),
};

interface BrandMarkProps {
  id: BrandMarkId;
  /** Edge length in px. The marks are drawn on a 24×24 grid and scale cleanly. */
  size?: number;
}

/**
 * One provider mark, decorative.
 *
 * `aria-hidden` because the row already names the provider in text — a screen
 * reader announcing "Gmail" twice is noise, and every caller here renders the
 * name beside the mark.
 */
export function BrandMark({ id, size = 20 }: BrandMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      style={{ display: 'block', flexShrink: 0 }}
      data-testid={`brand-mark-${id}`}
    >
      {MARKS[id]}
    </svg>
  );
}

/**
 * The tile the mark sits in, shared by the desktop node and the mobile card.
 *
 * Was a coloured square behind an emoji. A provider mark carries its own colour,
 * so the tile is now near-white and only its border responds to connectedness —
 * a sand-coloured tile behind Gmail's white envelope muddied both.
 */
export function brandTileStyle(isConnected: boolean, edge = 30): React.CSSProperties {
  return {
    width: edge,
    height: edge,
    flexShrink: 0,
    borderRadius: radii.kv,
    display: 'grid',
    placeItems: 'center',
    fontSize: typography.px.bodyLarge,
    backgroundColor: colors.porcelain,
    border: `1px solid ${isConnected ? colors.claretLight : colors.linenShade}`,
  };
}
