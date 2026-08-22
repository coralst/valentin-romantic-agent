import { describe, it, expect, beforeEach } from 'vitest';
import {
  discardLegacySessions,
  loadSidebarCollapsed,
  saveSidebarCollapsed,
  formatRelativeTime,
} from '../use-session-store';

describe('use-session-store', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('discardLegacySessions', () => {
    it('reports nothing to discard on a browser that never held any', () => {
      expect(discardLegacySessions()).toBe(0);
    });

    it('clears the old key and reports how many were there', () => {
      // The count is what the sidebar's one-time notice says out loud, so it has
      // to be the real number rather than a boolean.
      localStorage.setItem(
        'valentin_sessions',
        JSON.stringify([{ id: 'a' }, { id: 'b' }, { id: 'c' }]),
      );

      expect(discardLegacySessions()).toBe(3);
      expect(localStorage.getItem('valentin_sessions')).toBeNull();
    });

    it('discards unreadable data without throwing', () => {
      localStorage.setItem('valentin_sessions', '{not valid json!!!');

      expect(discardLegacySessions()).toBe(0);
      expect(localStorage.getItem('valentin_sessions')).toBeNull();
    });

    it('is a no-op the second time, so the notice appears once', () => {
      localStorage.setItem('valentin_sessions', JSON.stringify([{ id: 'a' }]));

      expect(discardLegacySessions()).toBe(1);
      expect(discardLegacySessions()).toBe(0);
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
