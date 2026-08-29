import { useEffect, useMemo, useRef, useState } from 'react';

import type { ChatMessage } from '../../shared/interfaces/message';
import type { PreferenceWithHistory } from '../../shared/interfaces/preference';
import { MessageBubble } from './MessageBubble';
import { LearnedStatus, type LearnedAnnouncement } from './LearnedStatus';
import { ProposalCard } from './ProposalCard';
import { usePreferencesContext } from '../context/preferences-context';
import { discoveryKey } from '../hooks/use-preferences-state';
import type { ProposalEntry } from '../hooks/use-chat-state';
import { insets, typography } from '../design-system/tokens';
import { chatMeasureStyle } from './chat-measure';

interface MessageHistoryProps {
  messages: ChatMessage[];
  /** Proposals awaiting a yes, plus the ones already answered. */
  proposals?: ProposalEntry[];
  onConfirmProposal?: (proposalId: string) => void;
  onDismissProposal?: (proposalId: string) => void;
}

const containerStyle: React.CSSProperties = {
  flex: 1,
  // A column, so an empty transcript's placeholder can be told to fill the track
  // rather than sitting as a line of text at the top of a tall blank area.
  display: 'flex',
  flexDirection: 'column',
  // Load-bearing: without it this flex child sizes to the whole transcript and
  // shoves the composer out through the bottom of the window
  // (option-5d-brief.html:41-42,47).
  minHeight: 0,
  minWidth: 0,
  overflowY: 'auto',
  padding: `20px ${insets.roomy}px 10px`,
};

/** Caps the measure of the transcript without narrowing the scroll gutter. */
const innerStyle: React.CSSProperties = chatMeasureStyle;

/**
 * What fills the transcript before anything has been said.
 *
 * There was nothing here, and on a wide screen with the architecture drawer open
 * that read as a rendering fault: the column is at its widest exactly when the
 * transcript is at its shortest, so a new session showed several hundred pixels of
 * blank cream between the header and the composer. Seeding the demo profile lands
 * you here too — it opens its own session, which has no greeting in it yet.
 *
 * Centred in the track rather than pinned to the top, because a line of grey text
 * under the header looks like the first message failed to load.
 */
const emptyMeasureStyle: React.CSSProperties = {
  // The measure box, told to fill the track so what is centred inside it is
  // centred in the column rather than tucked under the header. Kept as a variant
  // of `chatMeasureStyle` rather than a sibling of it: the header, the transcript
  // and the composer are asserted to share one measure, and the transcript's
  // contribution to that is this element (AppLayout.scaling.test.tsx).
  ...chatMeasureStyle,
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
};

const emptyTranscriptStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'grid',
  placeItems: 'center',
  padding: '24px 0',
};

const emptyTranscriptCopyStyle: React.CSSProperties = {
  margin: 0,
  maxWidth: '34ch',
  textAlign: 'center',
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.label,
  lineHeight: 1.6,
  color: 'rgba(42, 34, 38, 0.55)',
};

export function MessageHistory({
  messages,
  proposals = [],
  onConfirmProposal,
  onDismissProposal,
}: MessageHistoryProps) {
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

  // A proposal arriving scrolls too. It is the thing the conversation was for,
  // and a Confirm button below the fold is a Confirm button nobody presses.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, proposals.length]);

  // `proposals` counts: a session whose only content is a card awaiting a yes is
  // not empty, and telling its owner to start talking would be wrong.
  const isEmpty = messages.length === 0 && proposals.length === 0;

  return (
    <div role="log" style={containerStyle} aria-label="Message history">
      <div style={isEmpty ? emptyMeasureStyle : innerStyle}>
        {isEmpty && (
          <div style={emptyTranscriptStyle} data-testid="transcript-empty">
            <p style={emptyTranscriptCopyStyle}>
              Nothing said yet. Tell Valentin something about her — a food she loves, a
              place she talks about — and he will start keeping track.
            </p>
          </div>
        )}
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
        {/*
          Proposals sit at the tail rather than beside the message that raised
          them, for the same reason: nothing renders below the newest one, so a
          card appearing cannot push the sentence being read up off the screen.
          They are also the live part of the transcript — whatever is still
          awaiting a yes should be the last thing on screen.
        */}
        {proposals.map((entry) => (
          <ProposalCard
            key={entry.proposal.proposalId}
            proposal={entry.proposal}
            status={entry.status}
            onConfirm={(id) => onConfirmProposal?.(id)}
            onDismiss={(id) => onDismissProposal?.(id)}
          />
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
