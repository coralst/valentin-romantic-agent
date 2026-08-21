import { v4 as uuidv4 } from 'uuid';
import type { ChatMessage } from '../../shared/interfaces/message';
import type { PreferenceWithHistory } from '../../shared/interfaces/preference';

/** A session persisted to localStorage */
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

const STORAGE_KEY = 'valentin_sessions';
const SIDEBAR_COLLAPSED_KEY = 'valentin_sidebar_collapsed';
const MAX_SESSIONS = 10;

/** Load all sessions from localStorage with corruption recovery */
export function loadSessions(): StoredSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      localStorage.removeItem(STORAGE_KEY);
      return [];
    }
    return parsed as StoredSession[];
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return [];
  }
}

/** Persist all sessions to localStorage, enforcing the max limit */
export function saveSessions(sessions: StoredSession[]): void {
  const sorted = [...sessions].sort(
    (a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime(),
  );
  const trimmed = sorted.slice(0, MAX_SESSIONS);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
}

/** Save or update a single session in the store */
export function saveSession(session: StoredSession): void {
  const sessions = loadSessions();
  const idx = sessions.findIndex((s) => s.id === session.id);
  if (idx >= 0) {
    sessions[idx] = session;
  } else {
    sessions.unshift(session);
  }
  saveSessions(sessions);
}

/** Delete a session by id */
export function deleteSession(id: string): void {
  const sessions = loadSessions();
  const filtered = sessions.filter((s) => s.id !== id);
  saveSessions(filtered);
}

/** Rename a session by id, persisting the new title */
export function renameSession(id: string, title: string): void {
  const sessions = loadSessions();
  const idx = sessions.findIndex((s) => s.id === id);
  if (idx < 0) return;
  const trimmed = title.trim();
  sessions[idx] = { ...sessions[idx], title: trimmed.length > 0 ? trimmed : null };
  saveSessions(sessions);
}

/** Create a brand new empty session */
export function createNewSession(): StoredSession {
  return {
    id: uuidv4(),
    title: null,
    partnerName: null,
    messages: [],
    preferences: [],
    lastActivity: new Date().toISOString(),
    messageCount: 0,
  };
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
