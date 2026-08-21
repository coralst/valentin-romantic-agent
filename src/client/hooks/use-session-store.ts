import type { ChatMessage } from '../../shared/interfaces/message';
import type { PreferenceWithHistory } from '../../shared/interfaces/preference';

/** One conversation as the sidebar renders it, fetched from the server */
export interface StoredSession {
  id: string;
  /** User-given name for the conversation. Takes precedence over the
   *  auto-derived partnerName when displaying the session title. */
  title: string | null;
  partnerName: string | null;
  messages: ChatMessage[];
  preferences: PreferenceWithHistory[];
  lastActivity: string;
  messageCount: number;
}

/**
 * Where conversations used to live. Read once, to clear it — see
 * discardLegacySessions.
 */
const LEGACY_STORAGE_KEY = 'valentin_sessions';
const SIDEBAR_COLLAPSED_KEY = 'valentin_sidebar_collapsed';

/**
 * Clear conversations left behind by the localStorage era, reporting how many.
 *
 * They are not worth importing: the old store never wrote a single message into
 * a session (nothing ever dispatched the update that would have), so every one
 * of them is a title and an empty transcript. Migrating them would move empty
 * shells onto the server and make the sidebar look broken in a new way. The
 * caller shows a one-time notice instead.
 */
export function discardLegacySessions(): number {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return 0;
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    // Unreadable is still discarded — that is the whole point of the call.
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    return 0;
  }
}

/** Load sidebar collapsed state */
export function loadSidebarCollapsed(): boolean {
  try {
    const raw = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
    return raw === 'true';
  } catch {
    return false;
  }
}

/** Persist sidebar collapsed state */
export function saveSidebarCollapsed(collapsed: boolean): void {
  localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
}

/** Format a timestamp as relative time (e.g. "just now", "2m ago", "1h ago", "yesterday", "Jul 28") */
export function formatRelativeTime(isoTimestamp: string): string {
  const now = Date.now();
  const then = new Date(isoTimestamp).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay === 1) return 'yesterday';

  const date = new Date(isoTimestamp);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[date.getMonth()]} ${date.getDate()}`;
}
