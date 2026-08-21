import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage } from '../../shared/interfaces/message';
import type { PreferenceWithHistory } from '../../shared/interfaces/preference';
import { MessageBubble } from './MessageBubble';
import { LearnedChip } from './LearnedChip';
import { usePreferencesContext } from '../context/preferences-context';
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
  const { state: preferencesState, dispatch: preferencesDispatch } = usePreferencesContext();

  /**
   * Chips the user has waved off. Visibility is tracked here rather than read
   * back off the preferences store because a discovery stays in the store
   * forever (it is real profile data) — dismissing the chip only hides the
   * note in the transcript, it must never unlearn the preference.
   */
  const [dismissedIds, setDismissedIds] = useState<ReadonlySet<string>>(new Set());

  /**
   * Discoveries grouped by the message that produced them, so each chip lands
   * directly under the exchange it came from instead of all of them piling up
   * at the end of the transcript.
   */
  const chipsByMessageId = useMemo(() => {
    const grouped = new Map<string, PreferenceWithHistory[]>();
    for (const list of Object.values(preferencesState.preferences)) {
      for (const pref of list) {
        if (!pref.sourceMessageId || dismissedIds.has(pref.id)) continue;
        const existing = grouped.get(pref.sourceMessageId);
        if (existing) existing.push(pref);
        else grouped.set(pref.sourceMessageId, [pref]);
      }
    }
    return grouped;
  }, [preferencesState.preferences, dismissedIds]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const lastMessage = messages[messages.length - 1];

  const handleDismiss = (preferenceId: string) => {
    setDismissedIds((prev) => new Set(prev).add(preferenceId));
    // Keep the shared highlight state in step, so a dismissed discovery stops
    // pulsing on the other surfaces that render it too.
    preferencesDispatch({ type: 'CLEAR_HIGHLIGHT', preferenceId });
  };

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
            {chipsByMessageId.get(msg.id)?.map((pref) => (
              <LearnedChip
                key={pref.id}
                value={pref.value}
                confidence={pref.confidence}
                onDismiss={() => handleDismiss(pref.id)}
              />
            ))}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
