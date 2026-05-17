import type { AppSettings } from "@/types/egdata";

const SETTINGS_KEY = "egdata-settings";

export const defaultSettings: AppSettings = {
  country: "US",
  overlayEnabled: true,
  notificationsEnabled: false,
  freeGameRemindersEnabled: false,
  dealAlertsEnabled: false,
};

function hasChromeStorage() {
  return typeof chrome !== "undefined" && Boolean(chrome.storage?.local);
}

export class SettingsService {
  async getSettings(): Promise<AppSettings> {
    if (!hasChromeStorage()) {
      return defaultSettings;
    }

    return new Promise((resolve) => {
      chrome.storage.local.get(SETTINGS_KEY, (result) => {
        resolve({
          ...defaultSettings,
          ...(result[SETTINGS_KEY] as Partial<AppSettings> | undefined),
        });
      });
    });
  }

  async updateSettings(patch: Partial<AppSettings>) {
    const settings = {
      ...(await this.getSettings()),
      ...patch,
    };

    if (!hasChromeStorage()) {
      return settings;
    }

    await new Promise<void>((resolve) => {
      chrome.storage.local.set({ [SETTINGS_KEY]: settings }, () => resolve());
    });

    return settings;
  }
}

export const settingsService = new SettingsService();
