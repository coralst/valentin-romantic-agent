import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

/**
 * Which of the app's two top-level surfaces is on screen.
 *
 * `chat` is the four-column shell — icon rail, conversation list, chat, brief.
 * `dossier` is the full-page profile control panel, which replaces columns 2–4
 * while keeping the icon rail and the window chrome (`full-profile.html:19`).
 */
export type Surface = 'chat' | 'dossier';

export interface ViewContextValue {
  surface: Surface;
  setSurface: (surface: Surface) => void;
  /** Shows the dossier. */
  openDossier: () => void;
  /**
   * Hides the dossier *and returns focus to the control that opened it*.
   *
   * Same focus discipline as the architecture drawer: focus is never stolen when
   * a surface opens (the user may be mid-sentence in the composer), but it must
   * not be stranded on a removed element when one closes.
   */
  closeDossier: () => void;
  /** What the icon rail's ♥ does. */
  toggleDossier: () => void;
  /**
   * What the icon rail's ◆ does: leave the dossier if it is up, and put the
   * caret in the composer either way.
   *
   * Distinct from `closeDossier` because it is not "undo the dossier" — it is
   * "take me to the conversation", which is a thing to ask for from the chat
   * shell too, and there the observable result is the caret.
   */
  returnToChat: () => void;
  /**
   * Attach to the rail's ♥ button. `closeDossier` focuses it, so the ref has to
   * live with the state rather than with either component.
   */
  dossierToggleRef: React.RefObject<HTMLButtonElement | null>;
}

/**
 * The surface state.
 *
 * Deliberately *not* persisted and not in the URL. There is no router here and
 * this is not the place to add one: reloading straight into the dossier with no
 * conversation behind it is a poor cold start, and it would make the Playwright
 * specs' `goto('/')` non-deterministic.
 *
 * Deliberately *not* a portal either. Nothing in the window portals out any
 * more: the old inspector did, to escape the deleted header's `backdrop-filter`
 * containing block, and `LiveArchitectureDrawer` replaced it with an absolutely
 * positioned panel that stays inside. The dossier is not an overlay at all — it
 * shares the icon rail and the window's 34px radius, so portalling it would
 * duplicate the rail and fight the window's `overflow: hidden`.
 */
/**
 * The composer's accessible name, which is also how the ◆ finds it.
 *
 * Queried rather than held as a ref on purpose: the composer is two components
 * below the chat column (`ChatPanel` → `MessageInput`), and threading a ref from
 * the icon rail through both of them — for a focus nicety, not for behaviour —
 * would give the layout a second, competing notion of "the composer". The name
 * is pinned by `MessageInput`'s own tests and by the test for ◆ below, so it
 * cannot drift silently.
 */
const COMPOSER_SELECTOR = 'textarea[aria-label="Type a message"]';

export function useViewState(): ViewContextValue {
  const [surface, setSurface] = useState<Surface>('chat');
  const dossierToggleRef = useRef<HTMLButtonElement>(null);

  /**
   * True while the browser's history holds the entry `openDossier` pushed.
   *
   * A ref rather than state: nothing renders from it, and it has to be correct
   * inside a `popstate` handler that fires after the render that closed the
   * dossier.
   */
  const ownsHistoryEntry = useRef(false);

  /** Hide the dossier and bring focus home. The single place `surface` clears. */
  const applyClose = useCallback(() => {
    setSurface('chat');
    dossierToggleRef.current?.focus();
  }, []);

  /*
   * Opening pushes a history entry, so the browser's Back button (and the
   * trackpad's back swipe) closes the dossier instead of leaving the app —
   * which is the one route out that genuinely did not work, and the one a
   * presenter reaches for first.
   *
   * This is *not* the router the note above rules out: the URL never changes and
   * nothing is read back from history on mount, so a reload still lands on the
   * chat shell and the Playwright specs' `goto('/')` stays deterministic. All
   * that is added is one entry whose only job is to be popped.
   */
  const openDossier = useCallback(() => {
    if (surface === 'dossier') return;
    if (!ownsHistoryEntry.current) {
      window.history.pushState({ valentinDossier: true }, '');
      ownsHistoryEntry.current = true;
    }
    setSurface('dossier');
  }, [surface]);

  const closeDossier = useCallback(() => {
    // Close first and synchronously: `popstate` is a task, and the ← must not
    // wait a turn of the event loop to do anything visible.
    applyClose();
    if (ownsHistoryEntry.current) {
      ownsHistoryEntry.current = false;
      // Drop the entry we pushed, so Back does not step *into* a dossier the
      // user has already left. The `popstate` this provokes finds `surface`
      // already on chat and does nothing.
      window.history.back();
    }
  }, [applyClose]);

  const toggleDossier = useCallback(() => {
    if (surface === 'dossier') closeDossier();
    else openDossier();
  }, [surface, closeDossier, openDossier]);

  const returnToChat = useCallback(() => {
    if (surface === 'dossier') closeDossier();
    // After a frame, because on the way out of the dossier the chat column does
    // not exist yet at this point — the surface swap has only been queued.
    requestAnimationFrame(() => {
      document.querySelector<HTMLTextAreaElement>(COMPOSER_SELECTOR)?.focus();
    });
  }, [surface, closeDossier]);

  useEffect(() => {
    if (surface !== 'dossier') return;
    const handlePop = () => {
      ownsHistoryEntry.current = false;
      applyClose();
    };
    window.addEventListener('popstate', handlePop);
    return () => window.removeEventListener('popstate', handlePop);
  }, [surface, applyClose]);

  return {
    surface,
    setSurface,
    openDossier,
    closeDossier,
    toggleDossier,
    returnToChat,
    dossierToggleRef,
  };
}

const ViewContext = createContext<ViewContextValue | null>(null);

interface ViewProviderProps {
  children: React.ReactNode;
  /** The result of the one `useViewState()` call in the app. */
  value: ViewContextValue;
}

/**
 * Publishes the active surface, so the icon rail, the brief's footer link and
 * the dossier's own back button can all drive it without threading callbacks
 * through four levels of layout.
 */
export function ViewProvider({ children, value }: ViewProviderProps) {
  return <ViewContext.Provider value={value}>{children}</ViewContext.Provider>;
}

/** Consumer hook — throws outside `ViewProvider`. */
export function useViewContext(): ViewContextValue {
  const context = useOptionalViewContext();
  if (!context) {
    throw new Error('useViewContext must be used within a ViewProvider');
  }
  return context;
}

/**
 * Non-throwing variant, for surfaces that are *enriched* by the view state but
 * must still render without it.
 *
 * `BriefRail` is the motivating case: its footer grows a "Full profile →" link
 * when the provider is above it, but the rail is also rendered on its own in
 * unit tests and it should render there rather than crash.
 */
export function useOptionalViewContext(): ViewContextValue | null {
  return useContext(ViewContext);
}
