import { egdataClient } from "@/lib/clients/egdata";
import {
  formatPrice,
  getBestImage,
  getEgdataOfferUrl,
  getOfferStoreUrl,
  normalizeOfferKey,
} from "@/lib/offer-utils";
import type { EgdataOffer, WatchlistItem } from "@/types/egdata";
import { openDB, type IDBPDatabase } from "idb";

const DB_NAME = "egdata-assistant";
const DB_VERSION = 1;
const WATCHLIST_STORE = "watchlist";
const OFFER_CACHE_STORE = "offer-cache";

export interface OfferCacheEntry {
  key: string;
  slug?: string;
  offerId?: string | null;
  namespace?: string | null;
  status?: string;
  updatedAt: string;
  expiresAt: string;
}

export class WatchlistService {
  private dbPromise: Promise<IDBPDatabase>;

  constructor() {
    this.dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(WATCHLIST_STORE)) {
          db.createObjectStore(WATCHLIST_STORE, { keyPath: "key" });
        }
        if (!db.objectStoreNames.contains(OFFER_CACHE_STORE)) {
          db.createObjectStore(OFFER_CACHE_STORE, { keyPath: "key" });
        }
      },
    });
  }

  private async db() {
    return this.dbPromise;
  }

  async getAll() {
    const db = await this.db();
    return (await db.getAll(WATCHLIST_STORE)) as WatchlistItem[];
  }

  async count() {
    const db = await this.db();
    return db.count(WATCHLIST_STORE);
  }

  async get(namespace: string, offerId: string) {
    const db = await this.db();
    return db.get(WATCHLIST_STORE, normalizeOfferKey(namespace, offerId)) as
      | Promise<WatchlistItem | undefined>
      | WatchlistItem
      | undefined;
  }

  async upsert(item: Omit<WatchlistItem, "key" | "createdAt" | "updatedAt">) {
    const db = await this.db();
    const key = normalizeOfferKey(item.namespace, item.offerId);
    const existing = (await db.get(WATCHLIST_STORE, key)) as
      | WatchlistItem
      | undefined;
    const now = new Date().toISOString();
    const next: WatchlistItem = {
      ...existing,
      ...item,
      key,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    await db.put(WATCHLIST_STORE, next);
    return next;
  }

  async upsertFromOffer(
    offer: EgdataOffer,
    country: string,
    targetPrice?: number | null,
  ) {
    return this.upsert({
      offerId: offer.id,
      namespace: offer.namespace,
      title: offer.title,
      country,
      targetPrice,
      currentPrice: offer.price?.price ?? null,
      lastSeenPrice: offer.price?.price ?? null,
      lastNotifiedPrice: null,
      imageUrl: getBestImage(offer.keyImages, true)?.url ?? null,
      storeUrl: getOfferStoreUrl(offer),
      egdataUrl: getEgdataOfferUrl(offer.id),
    });
  }

  async remove(namespace: string, offerId: string) {
    const db = await this.db();
    await db.delete(WATCHLIST_STORE, normalizeOfferKey(namespace, offerId));
  }

  async clear() {
    const db = await this.db();
    await db.clear(WATCHLIST_STORE);
  }

  async cacheOffer(entry: Omit<OfferCacheEntry, "updatedAt">) {
    const db = await this.db();
    await db.put(OFFER_CACHE_STORE, {
      ...entry,
      updatedAt: new Date().toISOString(),
    });
  }

  async getOfferCacheCount() {
    const db = await this.db();
    return db.count(OFFER_CACHE_STORE);
  }

  async clearOfferCache() {
    const db = await this.db();
    await db.clear(OFFER_CACHE_STORE);
  }

  async checkPrices(country: string) {
    const items = await this.getAll();
    const checked: WatchlistItem[] = [];
    const triggered: WatchlistItem[] = [];

    for (const item of items) {
      try {
        const offer = await egdataClient.getOfferOverview(item.offerId, country);
        const currentPrice = offer.price?.price ?? item.currentPrice ?? null;
        const next = await this.upsert({
          ...item,
          country,
          currentPrice,
          lastSeenPrice: currentPrice,
          imageUrl: item.imageUrl ?? getBestImage(offer.keyImages, true)?.url,
          storeUrl: item.storeUrl ?? getOfferStoreUrl(offer),
          egdataUrl: item.egdataUrl || getEgdataOfferUrl(item.offerId),
          lastCheckedAt: new Date().toISOString(),
        });

        checked.push(next);

        if (
          currentPrice &&
          item.targetPrice != null &&
          currentPrice.discountPrice <= item.targetPrice &&
          item.lastNotifiedPrice !== currentPrice.discountPrice
        ) {
          triggered.push(next);
        }
      } catch {
        checked.push(item);
      }
    }

    return {
      checked,
      triggered,
      summary:
        triggered.length > 0
          ? `${triggered.length} watched offer(s) reached target price`
          : `Checked ${checked.length} watched offer(s)`,
    };
  }
}

export function watchlistNotificationMessage(item: WatchlistItem) {
  return `${item.title} is now ${formatPrice(item.currentPrice)}`;
}

export const watchlistService = new WatchlistService();
