import { useEffect, useMemo, useRef, useState } from 'react';

import type { ChatMessage } from '../../shared/interfaces/message';
import type { PreferenceWithHistory } from '../../shared/interfaces/preference';
import { MessageBubble } from './MessageBubble';
import { LearnedStatus, type LearnedAnnouncement } from './LearnedStatus';
import { usePreferencesContext } from '../context/preferences-context';
import { discoveryKey } from '../hooks/use-preferences-state';
import { insets, layout } from '../design-system/tokens';

interface MessageHistoryProps {
  messages: ChatMessage[];
}

const containerStyle: React.CSSProperties = {
  flex: 1,
  // Load-bearing: without it this flex child sizes to the whole transcript and
  // shoves the composer out through the bottom of the window
  // (option-5d-brief.html:41-42,47).
  minHeight: 0,
  minWidth: 0,
  overflowY: 'auto',
  padding: `20px ${insets.roomy}px 10px`,
};

/** Caps the measure of the transcript without narrowing the scroll gutter. */
const innerStyle: React.CSSProperties = {
  maxWidth: layout.chatColumnMaxWidth,
};

export function MessageHistory({ messages }: MessageHistoryProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const { state: preferencesState } = usePreferencesContext();

  /**
   * The batch announced most recently, handed to `LearnedStatus` which decides
   * how long it stays on screen.
   *
   * The transcript does not try to pin discoveries to the message that produced
   * them any more. It used to, and it could only ever guess: `sourceMessageId` is
   * the *server's* id for the user's message whereas the transcript renders the
   * optimistic copy under a locally generated uuid, so the anchor was "whatever
   * was last in the transcript when the fact arrived". A status line that lives
   * for four seconds needs no anchor at all — it belongs to the moment, not to a
   * message — which removes the guess rather than improving it.
   */
  const [announcement, setAnnouncement] = useState<LearnedAnnouncement | null>(null);

  /**
   * Discoveries already announced, keyed the same way the store keys them.
   *
   * This is only a within-mount dedupe — the store's `discovered` set is what
   * decides whether a fact is announceable at all. It has to be, because this ref
   * resets on remount and a session switch remounts the transcript: on its own it
   * would announce a restored conversation's entire dossier all over again.
   */
  const announcedRef = useRef(new Set<string>());

  const visiblePreferences = useMemo(() => {
    const all: PreferenceWithHistory[] = [];
    for (const list of Object.values(preferencesState.preferences)) all.push(...list);
    return all;
  }, [preferencesState.preferences]);

  const lastMessage = messages[messages.length - 1];

  useEffect(() => {
    const fresh = visiblePreferences.filter(
      (pref) =>
        preferencesState.discovered.has(discoveryKey(pref)) &&
        !announcedRef.current.has(discoveryKey(pref)),
    );
    if (fresh.length === 0) return;
    for (const pref of fresh) announcedRef.current.add(discoveryKey(pref));
    /*
     * One line for the whole batch. A single sentence routinely teaches Valentin
     * two unrelated things and the server is right to emit them as separate
     * events — merging them in the store would corrupt the dossier — but two
     * status lines saying almost the same thing is the stacked-card bug again in
     * a quieter font.
     */
    setAnnouncement({
      id: fresh.map((pref) => pref.id).join('|'),
      values: fresh.map((pref) => pref.value),
    });
  }, [visiblePreferences, preferencesState.discovered]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  return (
    <div role="log" style={containerStyle} aria-label="Message history">
      <div style={innerStyle}>
        {messages.map((msg) => (
          <div key={msg.id}>
            <MessageBubble
              message={msg}
              // Only the newest message animates; earlier ones render fully.
              animate={msg.id === lastMessage?.id && msg.sender === 'agent'}
            />
          </div>
        ))}
        {/*
          At the tail of the transcript rather than beside the message that
          produced it: nothing is ever rendered below the line, so its arrival
          and departure cannot displace anything the user is reading.
        */}
        <LearnedStatus announcement={announcement} />
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
