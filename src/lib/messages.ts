import type { Item } from '@/types/item';

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

export interface Settings {
  showOwnedBadges: boolean;
}

export interface LibrarySyncStatus {
  state: 'idle' | 'syncing' | 'success' | 'error';
  itemCount: number;
  startedAt?: number;
  lastSyncedAt?: number;
  lastError?: string;
}

export interface LibrarySearchParams {
  page?: number;
  pageSize?: number;
  searchQuery?: string;
  sortBy?: 'lastModifiedDate' | 'title';
  sortOrder?: 'asc' | 'desc';
}

export interface LibrarySearchResult {
  items: Item[];
  pagination: {
    currentPage: number;
    totalPages: number;
    totalItems: number;
    pageSize: number;
  };
}

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

export type InternalMessage =
  | { action: 'auth.getStatus' }
  | { action: 'auth.openLogin' }
  | { action: 'library.getStatus' }
  | { action: 'library.sync' }
  | { action: 'library.search'; payload?: LibrarySearchParams }
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
