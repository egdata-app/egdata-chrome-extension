import type {
  ApiResponse,
  AuthStatus,
  EgdataOffer,
  ExtensionHealth,
  InternalMessage,
  LibraryChangesResult,
  LibraryFilterOptions,
  LibrarySearchParams,
  LibrarySearchResult,
  LibrarySyncStatus,
  OfferLookupInput,
  OfferPriceHistoryResult,
  OwnedOffersResult,
  OwnedSlugsResult,
  PriceHistoryRequest,
  Settings,
  WatchlistCheckResult,
  WatchlistItem,
  WatchlistUpdatePayload,
} from '@/lib/messages';
import consola from 'consola';

const logger = consola.withTag('messaging');

export class MessagingClient {
  async sendMessage<T>(message: InternalMessage): Promise<T> {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(message, (response: ApiResponse<T>) => {
          if (chrome.runtime.lastError) {
            logger.error('Runtime error:', chrome.runtime.lastError);
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }

          if (!response) {
            reject(new Error('No response from background script'));
            return;
          }

          if (!response.ok) {
            reject(new Error(response.error));
            return;
          }

          resolve(response.data);
        });
      } catch (error) {
        logger.error('Error sending message:', error);
        reject(error);
      }
    });
  }

  getAuthStatus(): Promise<AuthStatus> {
    return this.sendMessage<AuthStatus>({ action: 'auth.getStatus' });
  }

  openEpicLogin(): Promise<{ tabId?: number }> {
    return this.sendMessage<{ tabId?: number }>({ action: 'auth.openLogin' });
  }

  getLibraryStatus(): Promise<LibrarySyncStatus> {
    return this.sendMessage<LibrarySyncStatus>({
      action: 'library.getStatus',
    });
  }

  syncLibrary(): Promise<LibrarySyncStatus> {
    return this.sendMessage<LibrarySyncStatus>({
      action: 'library.sync',
    });
  }

  searchLibrary(params: LibrarySearchParams): Promise<LibrarySearchResult> {
    return this.sendMessage<LibrarySearchResult>({
      action: 'library.search',
      payload: params,
    });
  }

  getLibraryChanges(): Promise<LibraryChangesResult> {
    return this.sendMessage<LibraryChangesResult>({
      action: 'getLibraryChanges',
    });
  }

  getLibraryFilterOptions(): Promise<LibraryFilterOptions> {
    return this.sendMessage<LibraryFilterOptions>({
      action: 'getLibraryFilterOptions',
    });
  }

  getHealth(): Promise<ExtensionHealth> {
    return this.sendMessage<ExtensionHealth>({ action: 'getHealth' });
  }

  checkOwnedSlugs(slugs: string[]): Promise<OwnedSlugsResult> {
    return this.sendMessage<OwnedSlugsResult>({
      action: 'ownership.checkSlugs',
      payload: { slugs },
    });
  }

  checkOwnedOffers(
    offers: OfferLookupInput[],
  ): Promise<OwnedOffersResult<OfferLookupInput>> {
    return this.sendMessage<OwnedOffersResult<OfferLookupInput>>({
      action: 'ownership.checkOffers',
      payload: { offers },
    });
  }

  getOfferPriceHistory(
    request: PriceHistoryRequest,
  ): Promise<OfferPriceHistoryResult> {
    return this.sendMessage<OfferPriceHistoryResult>({
      action: 'pricing.getOfferHistory',
      payload: request,
    });
  }

  getSettings(): Promise<Settings> {
    return this.sendMessage<Settings>({ action: 'settings.get' });
  }

  updateSettings(patch: Partial<Settings>): Promise<Settings> {
    return this.sendMessage<Settings>({
      action: 'settings.update',
      payload: patch,
    });
  }

  getFreeGames(): Promise<EgdataOffer[]> {
    return this.sendMessage<EgdataOffer[]>({ action: 'getFreeGames' });
  }

  getWatchlist(): Promise<WatchlistItem[]> {
    return this.sendMessage<WatchlistItem[]>({ action: 'getWatchlist' });
  }

  updateWatchlist(
    payload: WatchlistUpdatePayload,
  ): Promise<WatchlistItem | null> {
    return this.sendMessage<WatchlistItem | null>({
      action: 'updateWatchlist',
      payload,
    });
  }

  checkWatchlist(): Promise<WatchlistCheckResult> {
    return this.sendMessage<WatchlistCheckResult>({
      action: 'checkWatchlist',
    });
  }

  clearOfferCache(): Promise<{ success: true }> {
    return this.sendMessage<{ success: true }>({ action: 'clearOfferCache' });
  }
}

export const messagingClient = new MessagingClient();
