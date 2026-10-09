import { api } from './client';

export interface EntryPrefixesResponse {
  prefixes: string[];
}

/** Shared cache key: the settings page and the upload queue must agree. */
export const entryPrefixesQueryKey = ['settings', 'entry-prefixes'] as const;

/** queryFn shared by every observer of entryPrefixesQueryKey (string[] shape). */
export async function fetchEntryPrefixes(): Promise<string[]> {
  return (await settingsApi.getEntryPrefixes()).prefixes;
}

export const settingsApi = {
  getEntryPrefixes: (): Promise<EntryPrefixesResponse> =>
    api.request<EntryPrefixesResponse>('/settings/entry-prefixes'),
  updateEntryPrefixes: (prefixes: string[]): Promise<EntryPrefixesResponse> =>
    api.request<EntryPrefixesResponse>('/settings/entry-prefixes', {
      method: 'PUT',
      body: JSON.stringify({ prefixes }),
    }),
};
