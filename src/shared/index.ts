// Interfaces
export type { ChatMessage, Sender } from './interfaces/message';
export type {
  Preference,
  PreferenceCategory,
  PreferenceHistoryEntry,
  PreferenceWithHistory,
} from './interfaces/preference';
export type { SessionData } from './interfaces/session';
export type {
  WsEnvelope,
  ClientEvent,
  ServerEvent,
} from './interfaces/ws-events';

// Constants
export { PREFERENCE_CATEGORIES, CATEGORY_LABELS } from './constants/categories';
export {
  isPreferenceCategory,
  getCategoryLabel,
} from './constants/category-helpers';
