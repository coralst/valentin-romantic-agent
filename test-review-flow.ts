export interface StorageInterface {
  savePreference(pref: unknown): Promise<void>;
  getPreferencesBySession(sessionId: string): Promise<unknown[]>;
}
