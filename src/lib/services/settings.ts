import type { AppSettings } from '@/types/egdata';

const SETTINGS_KEY = 'egdata.settings';
const LEGACY_SETTINGS_KEY = 'egdata-settings';

export const DEFAULT_SETTINGS: AppSettings = {
  country: 'US',
  overlayEnabled: true,
  notificationsEnabled: false,
  freeGameRemindersEnabled: false,
  dealAlertsEnabled: false,
};

export const defaultSettings = DEFAULT_SETTINGS;

type StoredSettings = Partial<AppSettings> & {
  showOwnedBadges?: boolean;
};

function hasChromeStorage() {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local);
}

export class SettingsService {
  async getSettings(): Promise<AppSettings> {
    if (!hasChromeStorage()) {
      return DEFAULT_SETTINGS;
    }

    const result = await chrome.storage.local.get([
      SETTINGS_KEY,
      LEGACY_SETTINGS_KEY,
    ]);
    const legacy =
      (result[LEGACY_SETTINGS_KEY] as StoredSettings | undefined) ?? {};
    const current = (result[SETTINGS_KEY] as StoredSettings | undefined) ?? {};
    const stored: StoredSettings = { ...legacy, ...current };
    const overlayEnabled =
      typeof stored.overlayEnabled === 'boolean'
        ? stored.overlayEnabled
        : typeof stored.showOwnedBadges === 'boolean'
          ? stored.showOwnedBadges
          : DEFAULT_SETTINGS.overlayEnabled;

    return {
      ...DEFAULT_SETTINGS,
      ...stored,
      overlayEnabled,
    };
  }

  async updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    const settings = {
      ...(await this.getSettings()),
      ...patch,
    };

    if (!hasChromeStorage()) {
      return settings;
    }

    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
    return settings;
  }
}

export const settingsService = new SettingsService();

export function getSettings(): Promise<AppSettings> {
  return settingsService.getSettings();
}

export function updateSettings(
  patch: Partial<AppSettings>,
): Promise<AppSettings> {
  return settingsService.updateSettings(patch);
}
