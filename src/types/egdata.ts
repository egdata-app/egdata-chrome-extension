import type { Item } from "./item";
import type { KeyImage } from "./key-images";

export interface EgdataPriceValue {
  currencyCode: string;
  discount: number;
  discountPrice: number;
  originalPrice: number;
  basePayoutCurrencyCode?: string;
  basePayoutPrice?: number;
  payoutCurrencyExchangeRate?: number;
}

export interface EgdataPrice {
  offerId: string;
  namespace: string;
  country: string;
  price: EgdataPriceValue;
  region?: string;
  updatedAt?: string;
  appliedRules?: Array<{
    id?: string;
    name?: string;
    promotionStatus?: string;
    startDate?: string;
    endDate?: string;
    saleType?: string;
  }>;
}

export interface EgdataGiveaway {
  id: string;
  namespace: string;
  title: string;
  startDate: string;
  endDate: string;
}

export interface EgdataOffer {
  _id?: string;
  id: string;
  namespace: string;
  title: string;
  description?: string;
  offerType?: string;
  effectiveDate?: string;
  creationDate?: string;
  lastModifiedDate?: string;
  isCodeRedemptionOnly?: boolean;
  keyImages: KeyImage[];
  seller?: {
    id: string;
    name: string;
  };
  productSlug?: string | null;
  urlSlug?: string | null;
  url?: string | null;
  tags?: Array<{
    id: string;
    name: string;
  }>;
  items?: Array<Pick<Item, "id" | "namespace"> & Partial<Item>>;
  customAttributes?: Record<string, { type: string; value: string }>;
  categories?: string[];
  developerDisplayName?: string | null;
  publisherDisplayName?: string | null;
  prePurchase?: boolean | null;
  releaseDate?: string;
  pcReleaseDate?: string | null;
  viewableDate?: string;
  refundType?: string;
  price?: EgdataPrice;
  giveaway?: EgdataGiveaway;
}

export interface PaginatedEgdataResponse<T> {
  elements: T[];
  total?: number;
  page?: number;
  limit?: number;
}

export interface AppSettings {
  country: string;
  overlayEnabled: boolean;
  notificationsEnabled: boolean;
  freeGameRemindersEnabled: boolean;
  dealAlertsEnabled: boolean;
}

export interface WatchlistItem {
  key: string;
  offerId: string;
  namespace: string;
  title: string;
  storeUrl?: string | null;
  egdataUrl: string;
  imageUrl?: string | null;
  targetPrice?: number | null;
  currentPrice?: EgdataPriceValue | null;
  lastSeenPrice?: EgdataPriceValue | null;
  lastNotifiedPrice?: number | null;
  country: string;
  createdAt: string;
  updatedAt: string;
  lastCheckedAt?: string | null;
}

export type OwnershipStatus =
  | "unknown"
  | "owned"
  | "partial-upgrade"
  | "duplicate"
  | "missing-prerequisite"
  | "not-owned";

export interface OwnershipStatusResult {
  namespace: string;
  offerId: string;
  status: OwnershipStatus;
}

export interface SyncMetadata {
  status: "idle" | "syncing" | "success" | "error";
  lastStartedAt?: string;
  lastCompletedAt?: string;
  lastError?: string | null;
  totalItems: number;
  addedItemIds: string[];
  removedItemIds: string[];
  updatedItemIds: string[];
}

export interface ExtensionHealth {
  isAuthenticated: boolean;
  ownedItemCount: number;
  lastSyncAt?: string;
  lastSyncStatus: SyncMetadata["status"];
  lastSyncError?: string | null;
  overlayEnabled: boolean;
  notificationsEnabled: boolean;
  country: string;
  watchlistCount: number;
  cache: {
    offerCacheCount: number;
  };
}
