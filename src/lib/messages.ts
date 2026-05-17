import type {
  LibraryFilterOptions,
  LibraryItemRecord,
  LibrarySearchParams,
  LibrarySearchResult,
  LibrarySyncStatus,
} from '@/lib/services/library-sync';
import type {
  AppSettings,
  EgdataOffer,
  ExtensionHealth,
  SyncMetadata,
  WatchlistItem,
} from '@/types/egdata';

export type ApiResponse<T> =
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      error: string;
    };

export interface AuthStatus {
  isAuthenticated: boolean;
  expiresAt?: number;
}

export type Settings = AppSettings;

export interface OfferLookupInput {
  namespace: string;
  offerId: string;
}

export interface LegacyOfferLookupInput {
  namespace: string;
  id: string;
}

export interface OfferSlugMapping {
  slug: string;
  id: string | null;
  namespace: string | null;
}

export interface OwnedSlugsResult {
  ownedSlugs: string[];
  offerMappings: OfferSlugMapping[];
}

export interface OwnedOffersResult<TOffer extends OfferLookupInput> {
  ownedOffers: TOffer[];
}

export interface PagePrice {
  amount: number;
  currencyCode: string;
}

export type PriceHistoryTimeFrame = '6m' | '1y' | '2y' | 'all';

export interface PriceHistoryRequest {
  slug: string;
  offerId?: string;
  namespace?: string;
  pagePrice?: PagePrice;
  locale?: string;
  countryCandidate?: string;
  timeFrame?: PriceHistoryTimeFrame;
}

export interface PriceHistoryPoint {
  date: string;
  discountPrice: number;
  originalPrice: number | null;
  currencyCode: string;
}

export interface PriceHistoryCurrentPrice {
  discountPrice: number;
  originalPrice: number | null;
  currencyCode: string;
}

export interface OfferPriceHistoryResult {
  offerId: string;
  namespace: string;
  region: string;
  currencyCode: string;
  timeFrame: PriceHistoryTimeFrame;
  currentPrice: PriceHistoryCurrentPrice;
  minPrice: number | null;
  maxPrice: number | null;
  points: PriceHistoryPoint[];
}

export type WatchlistUpdatePayload =
  | { type: 'remove'; namespace: string; offerId: string }
  | {
      type: 'upsert';
      item: Omit<WatchlistItem, 'key' | 'createdAt' | 'updatedAt'>;
    };

export interface WatchlistCheckResult {
  checked: WatchlistItem[];
  triggered: WatchlistItem[];
  summary: string;
}

export interface LibraryChangesResult {
  metadata: SyncMetadata;
  addedItems: LibraryItemRecord[];
  removedItemIds: string[];
  updatedItemIds: string[];
}

export type InternalMessage =
  | { action: 'auth.getStatus' }
  | { action: 'auth.openLogin' }
  | { action: 'library.getStatus' }
  | { action: 'library.sync' }
  | { action: 'library.search'; payload?: LibrarySearchParams }
  | { action: 'syncLibrary' }
  | { action: 'searchLibrary'; payload?: LibrarySearchParams }
  | { action: 'getLibraryChanges' }
  | { action: 'getLibraryFilterOptions' }
  | { action: 'getHealth' }
  | { action: 'getSettings' }
  | { action: 'updateSettings'; payload: Partial<Settings> }
  | { action: 'getFreeGames' }
  | { action: 'getWatchlist' }
  | { action: 'updateWatchlist'; payload: WatchlistUpdatePayload }
  | { action: 'checkWatchlist' }
  | { action: 'clearOfferCache' }
  | { action: 'ownership.checkSlugs'; payload: { slugs: string[] } }
  | { action: 'ownership.checkOffers'; payload: { offers: OfferLookupInput[] } }
  | { action: 'pricing.getOfferHistory'; payload: PriceHistoryRequest }
  | { action: 'settings.get' }
  | { action: 'settings.update'; payload: Partial<Settings> };

export type ExternalMessage =
  | { action: 'ownership.checkSlugs'; payload: { slugs: string[] } }
  | { action: 'ownership.checkOffers'; payload: { offers: OfferLookupInput[] } }
  | { action: 'getOwnedSlugs'; payload: { slugs: string[] } }
  | { action: 'getOwnedOffers'; payload: { offers: LegacyOfferLookupInput[] } };

const INTERNAL_ACTIONS = new Set<InternalMessage['action']>([
  'auth.getStatus',
  'auth.openLogin',
  'library.getStatus',
  'library.sync',
  'library.search',
  'syncLibrary',
  'searchLibrary',
  'getLibraryChanges',
  'getLibraryFilterOptions',
  'getHealth',
  'getSettings',
  'updateSettings',
  'getFreeGames',
  'getWatchlist',
  'updateWatchlist',
  'checkWatchlist',
  'clearOfferCache',
  'ownership.checkSlugs',
  'ownership.checkOffers',
  'pricing.getOfferHistory',
  'settings.get',
  'settings.update',
]);

const EXTERNAL_ACTIONS = new Set<ExternalMessage['action']>([
  'ownership.checkSlugs',
  'ownership.checkOffers',
  'getOwnedSlugs',
  'getOwnedOffers',
]);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isInternalMessage(value: unknown): value is InternalMessage {
  return isRecord(value) && INTERNAL_ACTIONS.has(value.action as never);
}

export function isExternalMessage(value: unknown): value is ExternalMessage {
  return isRecord(value) && EXTERNAL_ACTIONS.has(value.action as never);
}

export function responseOk<T>(data: T): ApiResponse<T> {
  return { ok: true, data };
}

export function responseError(error: unknown): ApiResponse<never> {
  return {
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  };
}

export type {
  EgdataOffer,
  ExtensionHealth,
  LibraryFilterOptions,
  LibraryItemRecord,
  LibrarySearchParams,
  LibrarySearchResult,
  LibrarySyncStatus,
  WatchlistItem,
};
