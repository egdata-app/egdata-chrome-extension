import type {
  AppSettings,
  EgdataOffer,
  ExtensionHealth,
  WatchlistItem,
} from "@/types/egdata";
import type { LibraryResponse } from "@/types/get-library";
import type {
  LibrarySearchFilters,
  LibrarySearchResult,
} from "@/lib/services/library-sync";
import consola from "consola";

const logger = consola.withTag("messaging");

export class MessagingClient {
  async sendMessage<T>(opts: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(opts, (response) => {
          if (chrome.runtime.lastError) {
            logger.error("Runtime error:", chrome.runtime.lastError);
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve(response as T);
        });
      } catch (error) {
        logger.error("Error sending message:", error);
        reject(error);
      }
    });
  }

  async getEpicToken(): Promise<string> {
    const response = await this.sendMessage<
      { token: string } | { error: string }
    >({
      action: "getEpicToken",
    });

    if ("error" in response) {
      throw new Error(response.error);
    }

    return response.token;
  }

  async getLibrary({
    cursor,
  }: { cursor?: string } = {}): Promise<LibraryResponse> {
    const response = await this.sendMessage<
      { library: LibraryResponse } | { error: string }
    >({
      action: "getLibrary",
      payload: { cursor, excludeNs: ["ue"] },
    });

    if (!response) {
      throw new Error("No response from messaging client");
    }

    if ("error" in response) {
      logger.error("Error getting Epic Games library", response.error);
      throw new Error(response.error);
    }

    if (!response.library?.records) {
      throw new Error("Invalid library response: missing records array");
    }

    return response.library;
  }

  async getHealth(): Promise<ExtensionHealth> {
    const response = await this.sendMessage<
      { health: ExtensionHealth } | { error: string }
    >({ action: "getHealth" });

    if ("error" in response) {
      throw new Error(response.error);
    }

    return response.health;
  }

  async getSettings(): Promise<AppSettings> {
    const response = await this.sendMessage<
      { settings: AppSettings } | { error: string }
    >({ action: "getSettings" });

    if ("error" in response) {
      throw new Error(response.error);
    }

    return response.settings;
  }

  async updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    const response = await this.sendMessage<
      { settings: AppSettings } | { error: string }
    >({ action: "updateSettings", payload: patch });

    if ("error" in response) {
      throw new Error(response.error);
    }

    return response.settings;
  }

  async getFreeGames(): Promise<EgdataOffer[]> {
    const response = await this.sendMessage<
      { freeGames: EgdataOffer[] } | { error: string }
    >({ action: "getFreeGames" });

    if ("error" in response) {
      throw new Error(response.error);
    }

    return response.freeGames;
  }

  async getWatchlist(): Promise<WatchlistItem[]> {
    const response = await this.sendMessage<
      { watchlist: WatchlistItem[] } | { error: string }
    >({ action: "getWatchlist" });

    if ("error" in response) {
      throw new Error(response.error);
    }

    return response.watchlist;
  }

  async updateWatchlist(
    payload:
      | { type: "remove"; namespace: string; offerId: string }
      | {
          type: "upsert";
          item: Omit<WatchlistItem, "key" | "createdAt" | "updatedAt">;
        },
  ): Promise<WatchlistItem | null> {
    const response = await this.sendMessage<
      { item: WatchlistItem | null } | { error: string }
    >({ action: "updateWatchlist", payload });

    if ("error" in response) {
      throw new Error(response.error);
    }

    return response.item;
  }

  async checkWatchlist() {
    return this.sendMessage<{
      checked: WatchlistItem[];
      triggered: WatchlistItem[];
      summary: string;
    }>({ action: "checkWatchlist" });
  }

  async searchLibrary(payload: {
    page?: number;
    pageSize?: number;
    searchQuery?: string;
    sortBy?: "lastModifiedDate" | "title" | "acquisitionDate" | "developer";
    sortOrder?: "asc" | "desc";
    filters?: LibrarySearchFilters;
  }) {
    return this.sendMessage<LibrarySearchResult>({
      action: "searchLibrary",
      payload,
    });
  }
}

export const messagingClient = new MessagingClient();
