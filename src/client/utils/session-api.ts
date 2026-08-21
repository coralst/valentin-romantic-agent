import type { ChatMessage } from '../../shared/interfaces/message';
import type { PreferenceWithHistory } from '../../shared/interfaces/preference';
import type { SessionData } from '../../shared/interfaces/session';
import type { StoredSession } from '../hooks/use-session-store';
import { apiFetch, apiGetJson, apiPostJson, describeFailure } from './api-client';

/**
 * The sidebar's data source.
 *
 * It used to be localStorage, which meant a conversation existed only in the
 * browser that started it and vanished on a cache clear. Worse, the stored
 * sessions never held a single message (see session-context.tsx's history), so
 * switching conversations always landed on an empty transcript. Everything here
 * is scoped to the caller by the server — the user id is part of the key, so a
 * request for someone else's session simply misses and answers 404.
 */

interface SessionListResponse {
  sessions: SessionData[];
}

interface SessionDetailResponse {
  session: SessionData;
  messages: ChatMessage[];
  preferences: PreferenceWithHistory[];
}

/**
 * Adapt the server's session metadata to the shape the sidebar renders.
 *
 * `messages` and `preferences` stay empty in the list: the list view shows a
 * title, a relative time and a count, and fetching every transcript to render
 * ten rows would be gratuitous. `switchSession` fills them in on demand.
 */
export function toStoredSession(
  session: SessionData,
  contents: Pick<StoredSession, 'messages' | 'preferences'> = {
    messages: [],
    preferences: [],
  },
): StoredSession {
  return {
    id: session.id,
    title: session.title ?? null,
    partnerName: session.partnerName ?? null,
    messages: contents.messages,
    preferences: contents.preferences,
    lastActivity: session.lastActivity ?? session.createdAt,
    messageCount: session.messageCount,
  };
}

/** Every conversation belonging to the signed-in user, newest first */
export async function fetchSessions(): Promise<StoredSession[]> {
  const { sessions } = await apiGetJson<SessionListResponse>('/api/sessions');
  return sessions.map((session) => toStoredSession(session));
}

/** One conversation with its full transcript and profile */
export async function fetchSessionDetail(id: string): Promise<StoredSession> {
  const detail = await apiGetJson<SessionDetailResponse>(
    `/api/session/${encodeURIComponent(id)}`,
  );
  return toStoredSession(detail.session, {
    messages: detail.messages,
    preferences: detail.preferences,
  });
}

/** Start a new conversation, server-side, and return the empty session */
export async function createRemoteSession(): Promise<StoredSession> {
  const { sessionId } = await apiPostJson<{ sessionId: string }>('/api/session');
  return {
    id: sessionId,
    title: null,
    partnerName: null,
    messages: [],
    preferences: [],
    lastActivity: new Date().toISOString(),
    messageCount: 0,
  };
}

/** Rename a conversation. An empty title falls back to the partner's name. */
export async function renameRemoteSession(
  id: string,
  title: string,
): Promise<void> {
  const response = await apiFetch(`/api/session/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  if (!response.ok) throw new Error(describeFailure(response.status));
}

/** Delete a conversation along with its messages and preferences */
export async function deleteRemoteSession(id: string): Promise<void> {
  const response = await apiFetch(`/api/session/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error(describeFailure(response.status));
}
