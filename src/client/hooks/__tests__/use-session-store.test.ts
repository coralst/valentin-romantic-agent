import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  loadSessions,
  saveSessions,
  saveSession,
  deleteSession,
  createNewSession,
  loadSidebarCollapsed,
  saveSidebarCollapsed,
  formatRelativeTime,
  type StoredSession,
} from '../use-session-store';

describe('use-session-store', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('loadSessions', () => {
    it('returns empty array when no data in localStorage', () => {
      expect(loadSessions()).toEqual([]);
    });

    it('returns parsed sessions from localStorage', () => {
      const sessions: StoredSession[] = [
        {
          id: 'test-1',
          partnerName: 'Alice',
          messages: [],
          preferences: [],
          lastActivity: '2026-07-30T10:00:00.000Z',
          messageCount: 5,
        },
      ];
      localStorage.setItem('valentin_sessions', JSON.stringify(sessions));
      const result = loadSessions();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('test-1');
      expect(result[0].partnerName).toBe('Alice');
    });

    it('discards corrupt data and returns empty array', () => {
      localStorage.setItem('valentin_sessions', '{not valid json!!!');
      expect(loadSessions()).toEqual([]);
      expect(localStorage.getItem('valentin_sessions')).toBeNull();
    });

    it('discards non-array data and returns empty array', () => {
      localStorage.setItem('valentin_sessions', JSON.stringify({ foo: 'bar' }));
      expect(loadSessions()).toEqual([]);
      expect(localStorage.getItem('valentin_sessions')).toBeNull();
    });
  });

  describe('saveSessions', () => {
    it('persists sessions to localStorage', () => {
      const sessions: StoredSession[] = [
        {
          id: 's1',
          partnerName: null,
          messages: [],
          preferences: [],
          lastActivity: '2026-07-30T10:00:00.000Z',
          messageCount: 0,
        },
      ];
      saveSessions(sessions);
      const stored = JSON.parse(localStorage.getItem('valentin_sessions')!);
      expect(stored).toHaveLength(1);
      expect(stored[0].id).toBe('s1');
    });

    it('enforces maximum of 10 sessions, keeping most recent', () => {
      const sessions: StoredSession[] = Array.from({ length: 12 }, (_, i) => ({
        id: `s${i}`,
        partnerName: null,
        messages: [],
        preferences: [],
        lastActivity: new Date(2026, 6, 1 + i).toISOString(),
        messageCount: 0,
      }));
      saveSessions(sessions);
      const stored = JSON.parse(localStorage.getItem('valentin_sessions')!);
      expect(stored).toHaveLength(10);
      // Should contain the 10 most recent (indices 2-11)
      expect(stored[0].id).toBe('s11');
      expect(stored[9].id).toBe('s2');
    });

    it('sorts sessions by lastActivity descending', () => {
      const sessions: StoredSession[] = [
        { id: 'old', partnerName: null, messages: [], preferences: [], lastActivity: '2026-07-01T00:00:00.000Z', messageCount: 0 },
        { id: 'new', partnerName: null, messages: [], preferences: [], lastActivity: '2026-07-31T00:00:00.000Z', messageCount: 0 },
      ];
      saveSessions(sessions);
      const stored = JSON.parse(localStorage.getItem('valentin_sessions')!);
      expect(stored[0].id).toBe('new');
      expect(stored[1].id).toBe('old');
    });
  });

  describe('saveSession', () => {
    it('adds a new session to the store', () => {
      const session: StoredSession = {
        id: 'new-session',
        partnerName: 'Bob',
        messages: [],
        preferences: [],
        lastActivity: '2026-07-30T12:00:00.000Z',
        messageCount: 3,
      };
      saveSession(session);
      const sessions = loadSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe('new-session');
    });

    it('updates an existing session with the same id', () => {
      const session: StoredSession = {
        id: 'existing',
        partnerName: null,
        messages: [],
        preferences: [],
        lastActivity: '2026-07-30T10:00:00.000Z',
        messageCount: 0,
      };
      saveSession(session);
      saveSession({ ...session, partnerName: 'Updated', messageCount: 5 });
      const sessions = loadSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].partnerName).toBe('Updated');
      expect(sessions[0].messageCount).toBe(5);
    });
  });

  describe('deleteSession', () => {
    it('removes a session by id', () => {
      const sessions: StoredSession[] = [
        { id: 'keep', partnerName: null, messages: [], preferences: [], lastActivity: '2026-07-30T12:00:00.000Z', messageCount: 0 },
        { id: 'remove', partnerName: null, messages: [], preferences: [], lastActivity: '2026-07-30T10:00:00.000Z', messageCount: 0 },
      ];
      saveSessions(sessions);
      deleteSession('remove');
      const remaining = loadSessions();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe('keep');
    });

    it('does nothing if id does not exist', () => {
      const sessions: StoredSession[] = [
        { id: 'only', partnerName: null, messages: [], preferences: [], lastActivity: '2026-07-30T12:00:00.000Z', messageCount: 0 },
      ];
      saveSessions(sessions);
      deleteSession('nonexistent');
      expect(loadSessions()).toHaveLength(1);
    });
  });

  describe('createNewSession', () => {
    it('returns a session with a valid UUID id', () => {
      const session = createNewSession();
      expect(session.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it('returns a session with empty messages and preferences', () => {
      const session = createNewSession();
      expect(session.messages).toEqual([]);
      expect(session.preferences).toEqual([]);
      expect(session.messageCount).toBe(0);
      expect(session.partnerName).toBeNull();
    });

    it('returns a session with a recent lastActivity timestamp', () => {
      const before = new Date().toISOString();
      const session = createNewSession();
      const after = new Date().toISOString();
      expect(session.lastActivity >= before).toBe(true);
      expect(session.lastActivity <= after).toBe(true);
    });
  });

  describe('loadSidebarCollapsed / saveSidebarCollapsed', () => {
    it('defaults to false when no stored value', () => {
      expect(loadSidebarCollapsed()).toBe(false);
    });

    it('persists and restores true', () => {
      saveSidebarCollapsed(true);
      expect(loadSidebarCollapsed()).toBe(true);
    });

    it('persists and restores false', () => {
      saveSidebarCollapsed(true);
      saveSidebarCollapsed(false);
      expect(loadSidebarCollapsed()).toBe(false);
    });
  });

  describe('formatRelativeTime', () => {
    it('returns "just now" for timestamps less than 60 seconds ago', () => {
      const now = new Date().toISOString();
      expect(formatRelativeTime(now)).toBe('just now');
    });

    it('returns minutes ago for timestamps less than 60 minutes ago', () => {
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      expect(formatRelativeTime(fiveMinAgo)).toBe('5m ago');
    });

    it('returns hours ago for timestamps less than 24 hours ago', () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      expect(formatRelativeTime(twoHoursAgo)).toBe('2h ago');
    });

    it('returns "yesterday" for timestamps 24-48 hours ago', () => {
      const yesterday = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      expect(formatRelativeTime(yesterday)).toBe('yesterday');
    });

    it('returns month and day for older timestamps', () => {
      const oldDate = new Date(2026, 6, 15).toISOString(); // Jul 15
      const result = formatRelativeTime(oldDate);
      expect(result).toBe('Jul 15');
    });
  });
});
