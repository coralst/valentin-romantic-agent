import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  subscribeToWsEvents,
  publishInboundWsEvent,
  publishOutboundWsEvent,
  resetWsObservers,
} from '../ws-event-observer';
import type { ServerEvent } from '../../../shared/interfaces/ws-events';

const pongEvent: ServerEvent = {
  type: 'pong',
  payload: {},
  timestamp: '2026-08-21T10:00:00.000Z',
};

describe('ws-event-observer', () => {
  afterEach(() => {
    resetWsObservers();
  });

  it('delivers inbound events to a subscriber', () => {
    const observer = vi.fn();
    subscribeToWsEvents(observer);

    publishInboundWsEvent(pongEvent);

    expect(observer).toHaveBeenCalledWith({ direction: 'inbound', event: pongEvent });
  });

  it('delivers outbound events with outbound direction', () => {
    const observer = vi.fn();
    subscribeToWsEvents(observer);

    publishOutboundWsEvent({ type: 'ping', payload: {}, timestamp: pongEvent.timestamp });

    expect(observer).toHaveBeenCalledWith(
      expect.objectContaining({ direction: 'outbound' }),
    );
  });

  it('delivers to multiple subscribers', () => {
    const first = vi.fn();
    const second = vi.fn();
    subscribeToWsEvents(first);
    subscribeToWsEvents(second);

    publishInboundWsEvent(pongEvent);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('stops delivering after unsubscribe', () => {
    const observer = vi.fn();
    const unsubscribe = subscribeToWsEvents(observer);

    unsubscribe();
    publishInboundWsEvent(pongEvent);

    expect(observer).not.toHaveBeenCalled();
  });

  it('publishing with no subscribers does not throw', () => {
    expect(() => publishInboundWsEvent(pongEvent)).not.toThrow();
  });

  it('a throwing observer does not break delivery to others', () => {
    const healthy = vi.fn();
    subscribeToWsEvents(() => {
      throw new Error('observer blew up');
    });
    subscribeToWsEvents(healthy);

    expect(() => publishInboundWsEvent(pongEvent)).not.toThrow();
    expect(healthy).toHaveBeenCalledTimes(1);
  });
});
