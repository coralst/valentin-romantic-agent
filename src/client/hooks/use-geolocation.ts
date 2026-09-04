import { useCallback, useState } from 'react';

/**
 * Ask the browser where the user is — only ever because they clicked.
 *
 * ## Why there is no effect in this file
 *
 * A `getCurrentPosition` call on mount is the wrong design in three separate
 * ways. Browsers throttle or ignore permission prompts that were not triggered by
 * a gesture; a prompt nobody asked for is reflexively denied; and a denial is
 * **sticky per origin**, so one unprompted ask can cost the feature permanently
 * for that user with no way for the page to reset it. So the hook exposes a
 * `request` function and does nothing until it is called.
 *
 * ## Low accuracy, deliberately
 *
 * `enableHighAccuracy: false` — a city is all this is for. High accuracy wakes the
 * GPS, takes seconds longer, drains battery, and buys precision that is discarded
 * one function call later when the coordinate becomes a city name. `maximumAge`
 * accepts a cached fix up to five minutes old for the same reason: nobody changes
 * city in five minutes, and a cached fix is instant.
 *
 * The coordinate is handed to the caller and never stored here. What happens to it
 * is `POST /api/session/:id/location`'s business, and that route keeps only the
 * city.
 */

export type GeolocationStatus =
  /** Nothing asked for yet. */
  | 'idle'
  /** The browser is asking, or resolving. */
  | 'prompting'
  | 'granted'
  /** They said no — or said no earlier, since that decision sticks. */
  | 'denied'
  /** No geolocation in this browser, or it failed for a reason that is not a no. */
  | 'unavailable';

export interface Coordinate {
  lat: number;
  lon: number;
}

export interface GeolocationState {
  status: GeolocationStatus;
  coordinate: Coordinate | null;
  /** Something to show the user. Null unless there is a reason to say anything. */
  message: string | null;
  /** Ask. Resolves with the coordinate, or null if we did not get one. */
  request: () => Promise<Coordinate | null>;
  reset: () => void;
}

/** Long enough for a cold fix, short enough that a hung prompt is not forever. */
const TIMEOUT_MS = 8_000;

/**
 * Why we did not get a position, in words a person can act on.
 *
 * A denial is distinguished from a failure because the two need different
 * follow-ups: "type your city instead" versus "try again".
 */
function describeError(error: GeolocationPositionError): {
  status: GeolocationStatus;
  message: string;
} {
  if (error.code === error.PERMISSION_DENIED) {
    return {
      status: 'denied',
      message: 'No problem — type your city instead.',
    };
  }
  if (error.code === error.TIMEOUT) {
    return {
      status: 'unavailable',
      message: 'That took too long. Try again, or type your city.',
    };
  }
  return {
    status: 'unavailable',
    message: 'Your browser could not work out where you are. Type your city instead.',
  };
}

export function useGeolocation(): GeolocationState {
  const [status, setStatus] = useState<GeolocationStatus>('idle');
  const [coordinate, setCoordinate] = useState<Coordinate | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const request = useCallback(async (): Promise<Coordinate | null> => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setStatus('unavailable');
      setMessage('This browser cannot share a location. Type your city instead.');
      return null;
    }

    setStatus('prompting');
    setMessage(null);

    return new Promise<Coordinate | null>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const point = {
            lat: position.coords.latitude,
            lon: position.coords.longitude,
          };
          setCoordinate(point);
          setStatus('granted');
          resolve(point);
        },
        (error) => {
          const described = describeError(error);
          setStatus(described.status);
          setMessage(described.message);
          // Resolves rather than rejects: a refusal is an ordinary outcome of
          // asking, not an exception, and every caller has a typed-city fallback.
          resolve(null);
        },
        { enableHighAccuracy: false, timeout: TIMEOUT_MS, maximumAge: 300_000 },
      );
    });
  }, []);

  const reset = useCallback(() => {
    setStatus('idle');
    setCoordinate(null);
    setMessage(null);
  }, []);

  return { status, coordinate, message, request, reset };
}
