import type { ShareContinueResponse } from '../../shared/constants/share-link';
import { describeFailure } from '../utils/api-client';

/**
 * Trade a share link for a conversation of your own.
 *
 * Unauthenticated by necessity, exactly like `demo-login.ts`: this is the call that
 * *hands out* a token, so it cannot go through `apiFetch`. There is a second reason
 * here that does not apply to the demo — `apiFetch` would attach whatever bearer
 * token this tab happens to be holding, which would make a guest's request look
 * authenticated and could scope the fork to the wrong person.
 *
 * A 404 means the link is finished — expired, forged, or the conversation behind it
 * is gone. The server deliberately cannot tell those apart, so neither can this.
 */
export async function claimSharedConversation(
  token: string,
): Promise<ShareContinueResponse> {
  const response = await fetch(
    `/api/share/${encodeURIComponent(token)}/continue`,
    { method: 'POST' },
  );
  if (!response.ok) {
    throw new Error(describeFailure(response.status));
  }
  return (await response.json()) as ShareContinueResponse;
}
