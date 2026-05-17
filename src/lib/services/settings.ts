import type { Settings } from '@/lib/messages';

const SETTINGS_KEY = 'egdata.settings';

export const DEFAULT_SETTINGS: Settings = {
  showOwnedBadges: true,
};

export async function getSettings(): Promise<Settings> {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  return {
    ...DEFAULT_SETTINGS,
    ...((result[SETTINGS_KEY] as Partial<Settings> | undefined) ?? {}),
  };
}

export async function updateSettings(
  patch: Partial<Settings>,
): Promise<Settings> {
  const current = await getSettings();
  const next = {
    ...current,
    ...patch,
  };

  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}
