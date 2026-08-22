import React, { createContext, useCallback, useContext, useRef, useState } from 'react';

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
   * Same focus discipline as `ValentinInspector.tsx:521-524`: focus is never
   * stolen when a surface opens (the user may be mid-sentence in the composer),
   * but it must not be stranded on a removed element when one closes.
   */
  closeDossier: () => void;
  /** What the icon rail's ♥ does. */
  toggleDossier: () => void;
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
 * Deliberately *not* a portal either. The inspector portals (`ValentinInspector
 * .tsx:517-553`) because it is an overlay that has to escape a `backdrop-filter`
 * containing block. The dossier is not an overlay — it shares the icon rail and
 * the window's 34px radius, so portalling it would duplicate the rail and fight
 * the window's `overflow: hidden`.
 */
export function useViewState(): ViewContextValue {
  const [surface, setSurface] = useState<Surface>('chat');
  const dossierToggleRef = useRef<HTMLButtonElement>(null);

  const openDossier = useCallback(() => setSurface('dossier'), []);

  const closeDossier = useCallback(() => {
    setSurface('chat');
    dossierToggleRef.current?.focus();
  }, []);

  const toggleDossier = useCallback(() => {
    setSurface((current) => {
      if (current === 'dossier') {
        // Focus goes back to the ♥ on the way out, exactly as `.back` does.
        dossierToggleRef.current?.focus();
        return 'chat';
      }
      return 'dossier';
    });
  }, []);

  return { surface, setSurface, openDossier, closeDossier, toggleDossier, dossierToggleRef };
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
