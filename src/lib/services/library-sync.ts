import consola from "consola";
import { openDB, type IDBPDatabase } from "idb";
import type {
  LibraryResponse,
  Record as LibraryRecord,
} from "@/types/get-library";
import type { Item } from "@/types/item";
import { EpicGamesGraphQLClient } from "@/lib/clients/epic";
import type { SyncMetadata } from "@/types/egdata";
import { itemHasStorePage } from "@/lib/offer-utils";

const logger = consola.withTag("library-sync");

interface BulkResponse {
  items: Record<string, Item>;
}

export interface LibraryItemRecord extends Item {
  acquisitionDate?: string;
  ownedRecordType?: string;
  lastSeenInLibrarySync?: string;
}

export interface LibrarySearchFilters {
  itemType?: string;
  namespace?: string;
  developer?: string;
  category?: string;
  platform?: string;
  status?: string;
  unsearchable?: "all" | "yes" | "no";
  endOfSupport?: "all" | "yes" | "no";
  requiresSecureAccount?: "all" | "yes" | "no";
  storePage?: "all" | "yes" | "no";
}

export interface LibrarySearchResult {
  items: LibraryItemRecord[];
  allItems: LibraryItemRecord[];
  pagination: {
    currentPage: number;
    totalPages: number;
    totalItems: number;
    pageSize: number;
  };
}

export class LibrarySyncService {
  private readonly DB_NAME = "egdata-library";
  private readonly DB_VERSION = 2;
  private readonly STORE_NAME = "library-items";
  private readonly META_STORE_NAME = "sync-metadata";
  private readonly SYNC_INTERVAL = 5;
  private readonly META_KEY = "latest";
  private dbPromise: Promise<IDBPDatabase>;
  private currentLibrary: LibraryResponse | null = null;
  private epicClient: EpicGamesGraphQLClient | null = null;

  constructor() {
    this.dbPromise = this.initializeDB();
    this.setupAlarmListener();
  }

  private initializeDB() {
    return openDB(this.DB_NAME, this.DB_VERSION, {
      upgrade: (db) => {
        if (!db.objectStoreNames.contains(this.STORE_NAME)) {
          db.createObjectStore(this.STORE_NAME, { keyPath: "id" });
          logger.debug(`Created object store: ${this.STORE_NAME}`);
        }

        if (!db.objectStoreNames.contains(this.META_STORE_NAME)) {
          db.createObjectStore(this.META_STORE_NAME, { keyPath: "key" });
          logger.debug(`Created object store: ${this.META_STORE_NAME}`);
        }
      },
    });
  }

  private async db() {
    return this.dbPromise;
  }

  private setupAlarmListener() {
    if (typeof chrome === "undefined" || !chrome.alarms?.onAlarm) {
      return;
    }

    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === "library-sync" && this.currentLibrary) {
        this.syncLibrary(this.currentLibrary).catch((error) => {
          logger.error("Error in alarm sync:", error);
        });
      }
    });
  }

  private emptyMetadata(): SyncMetadata {
    return {
      status: "idle",
      totalItems: 0,
      addedItemIds: [],
      removedItemIds: [],
      updatedItemIds: [],
      lastError: null,
    };
  }

  private async saveSyncMetadata(metadata: SyncMetadata) {
    const db = await this.db();
    await db.put(this.META_STORE_NAME, {
      key: this.META_KEY,
      ...metadata,
    });
  }

  public async getSyncMetadata(): Promise<SyncMetadata> {
    const db = await this.db();
    const metadata = await db.get(this.META_STORE_NAME, this.META_KEY);
    if (!metadata) {
      return this.emptyMetadata();
    }

    const { key: _key, ...rest } = metadata as SyncMetadata & { key: string };
    return rest;
  }

  private async saveToIndexedDB(items: Record<string, LibraryItemRecord>) {
    const db = await this.db();
    const tx = db.transaction(this.STORE_NAME, "readwrite");
    const store = tx.objectStore(this.STORE_NAME);

    await store.clear();
    await Promise.all(Object.values(items).map((data) => store.put(data)));
    await tx.done;
    logger.debug("Successfully saved items to IndexedDB");
  }

  private async fetchBulkData(items: string[]): Promise<BulkResponse> {
    const BATCH_SIZE = 100;
    const batches = [];

    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      batches.push(items.slice(i, i + BATCH_SIZE));
    }

    const results = await Promise.all(
      batches.map(async (batch, index) => {
        logger.debug(`Fetching batch ${index + 1} of ${batches.length}`);

        const response = await fetch("https://api-gcp.egdata.app/items/bulk", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ items: batch }),
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        return response.json() as Promise<Item[]>;
      }),
    );

    const combinedResults = results.reduce<Record<string, Item>>(
      (acc, items) => {
        if (!Array.isArray(items)) {
          logger.warn("Invalid response from bulk API:", items);
          return acc;
        }

        return Object.assign(
          acc,
          Object.fromEntries(items.map((item) => [item.id, item])),
        );
      },
      {},
    );

    return { items: combinedResults };
  }

  private async getEpicClient(): Promise<EpicGamesGraphQLClient> {
    if (!this.epicClient) {
      const authCookie = await chrome.cookies.get({
        name: "EPIC_EG1",
        url: "https://store.epicgames.com",
      });

      if (!authCookie?.value) {
        throw new Error("Epic Games authentication cookie not found");
      }

      this.epicClient = new EpicGamesGraphQLClient({
        token: authCookie.value,
      });
    }
    return this.epicClient;
  }

  private async fetchLibraryPage(cursor?: string): Promise<LibraryResponse> {
    const client = await this.getEpicClient();
    const authCookie = await chrome.cookies.get({
      name: "EPIC_EG1",
      url: "https://store.epicgames.com",
    });

    if (!authCookie?.value) {
      throw new Error("Epic Games authentication cookie not found");
    }

    return client.getLibrary({
      token: authCookie.value,
      includeMetadata: true,
      cursor,
      excludeNs: ["ue"],
    });
  }

  public async syncLibrary(library: LibraryResponse) {
    const startedAt = new Date().toISOString();
    await this.saveSyncMetadata({
      ...(await this.getSyncMetadata()),
      status: "syncing",
      lastStartedAt: startedAt,
      lastError: null,
    });

    try {
      logger.info("Starting library sync");

      if (!library?.records) {
        throw new Error("Invalid library response: missing records array");
      }

      let allRecords = [...library.records];
      let nextCursor = library.responseMetadata.nextCursor;

      while (nextCursor) {
        const nextPage = await this.fetchLibraryPage(nextCursor);
        if (!nextPage?.records) {
          break;
        }

        allRecords = [...allRecords, ...nextPage.records];
        nextCursor = nextPage.responseMetadata.nextCursor;
      }

      const itemIds = Array.from(
        new Set(allRecords.map((record) => record.catalogItemId).filter(Boolean)),
      );

      if (itemIds.length === 0) {
        await this.saveSyncMetadata({
          status: "success",
          lastStartedAt: startedAt,
          lastCompletedAt: new Date().toISOString(),
          lastError: null,
          totalItems: 0,
          addedItemIds: [],
          removedItemIds: [],
          updatedItemIds: [],
        });
        return;
      }

      const currentItems = await this.getAllItems();
      const currentItemsById = new Map(currentItems.map((item) => [item.id, item]));
      const currentItemIds = new Set(currentItemsById.keys());
      const newItemIds = new Set(itemIds);
      const addedItemIds = itemIds.filter((id) => !currentItemIds.has(id));
      const removedItemIds = Array.from(currentItemIds).filter(
        (id) => !newItemIds.has(id),
      );
      const recordsByItemId = this.getRecordsByItemId(allRecords);
      const bulkData = await this.fetchBulkData(itemIds);
      const seenAt = new Date().toISOString();

      const itemsWithOwnership = Object.fromEntries(
        Object.entries(bulkData.items).map(([id, item]) => {
          const record = recordsByItemId.get(id);
          const previous = currentItemsById.get(id);
          return [
            id,
            {
              ...item,
              acquisitionDate: record?.acquisitionDate ?? previous?.acquisitionDate,
              ownedRecordType: record?.recordType ?? previous?.ownedRecordType,
              lastSeenInLibrarySync: seenAt,
            } satisfies LibraryItemRecord,
          ];
        }),
      );

      const updatedItemIds = Object.values(itemsWithOwnership)
        .filter((item) => {
          const previous = currentItemsById.get(item.id);
          return (
            previous &&
            (previous.lastModifiedDate !== item.lastModifiedDate ||
              previous.acquisitionDate !== item.acquisitionDate)
          );
        })
        .map((item) => item.id);

      await this.saveToIndexedDB(itemsWithOwnership);
      await this.saveSyncMetadata({
        status: "success",
        lastStartedAt: startedAt,
        lastCompletedAt: new Date().toISOString(),
        lastError: null,
        totalItems: itemIds.length,
        addedItemIds,
        removedItemIds,
        updatedItemIds,
      });

      logger.success("Library sync completed successfully");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to sync library";
      await this.saveSyncMetadata({
        ...(await this.getSyncMetadata()),
        status: "error",
        lastError: message,
      });
      logger.error("Error syncing library:", error);
      throw error;
    }
  }

  private getRecordsByItemId(records: LibraryRecord[]) {
    const recordsByItemId = new Map<string, LibraryRecord>();
    for (const record of records) {
      if (record.catalogItemId && !recordsByItemId.has(record.catalogItemId)) {
        recordsByItemId.set(record.catalogItemId, record);
      }
    }
    return recordsByItemId;
  }

  public startPeriodicSync(library: LibraryResponse) {
    this.currentLibrary = library;
    this.stopPeriodicSync();
    this.currentLibrary = library;

    this.syncLibrary(library).catch((error) => {
      logger.error("Error in initial sync:", error);
    });

    if (typeof chrome !== "undefined" && chrome.alarms) {
      chrome.alarms.create("library-sync", {
        periodInMinutes: this.SYNC_INTERVAL,
      });
    }
  }

  public stopPeriodicSync() {
    if (typeof chrome !== "undefined" && chrome.alarms) {
      chrome.alarms.clear("library-sync");
    }
    this.currentLibrary = null;
  }

  public async getAllItems(): Promise<LibraryItemRecord[]> {
    const db = await this.db();
    const tx = db.transaction(this.STORE_NAME, "readonly");
    const store = tx.objectStore(this.STORE_NAME);
    return (await store.getAll()) as LibraryItemRecord[];
  }

  public async getItem(id: string): Promise<LibraryItemRecord | undefined> {
    const db = await this.db();
    return db.get(this.STORE_NAME, id) as Promise<LibraryItemRecord | undefined>;
  }

  public async getLibraryChanges() {
    const metadata = await this.getSyncMetadata();
    const addedItems = (
      await Promise.all(metadata.addedItemIds.map((id) => this.getItem(id)))
    ).filter(Boolean) as LibraryItemRecord[];

    return {
      metadata,
      addedItems,
      removedItemIds: metadata.removedItemIds,
      updatedItemIds: metadata.updatedItemIds,
    };
  }

  public async getFilterOptions() {
    const items = await this.getAllItems();
    const values = <T,>(getter: (item: LibraryItemRecord) => T | T[] | undefined) =>
      Array.from(
        new Set(
          items
            .flatMap((item) => getter(item) ?? [])
            .filter((value): value is T => Boolean(value)),
        ),
      )
        .map(String)
        .sort((a, b) => a.localeCompare(b));

    return {
      namespaces: values((item) => item.namespace),
      developers: values((item) => item.developer),
      itemTypes: values((item) => item.itemType),
      statuses: values((item) => item.status),
      categories: values((item) =>
        item.categories?.map((category) => category.path),
      ),
      platforms: values((item) =>
        item.releaseInfo?.flatMap((release) => release.platform),
      ),
    };
  }

  public async searchItems({
    page = 1,
    pageSize = 12,
    searchQuery = "",
    sortBy = "lastModifiedDate",
    sortOrder = "desc",
    filters = {},
  }: {
    page?: number;
    pageSize?: number;
    searchQuery?: string;
    sortBy?: "lastModifiedDate" | "title" | "acquisitionDate" | "developer";
    sortOrder?: "asc" | "desc";
    filters?: LibrarySearchFilters;
  }): Promise<LibrarySearchResult> {
    const allItems = await this.getAllItems();
    const query = searchQuery.trim().toLowerCase();
    let filteredItems = allItems;

    if (query) {
      filteredItems = filteredItems.filter((item) =>
        [
          item.title,
          item.developer,
          item.namespace,
          item.itemType,
          item.status,
          ...item.categories.map((category) => category.path),
        ]
          .filter(Boolean)
          .some((value) => value.toLowerCase().includes(query)),
      );
    }

    filteredItems = filteredItems.filter((item) =>
      this.matchesFilters(item, filters),
    );

    filteredItems.sort((a, b) => {
      const aValue = String(a[sortBy] ?? "");
      const bValue = String(b[sortBy] ?? "");
      const result = aValue.localeCompare(bValue);
      return sortOrder === "asc" ? result : -result;
    });

    const totalItems = filteredItems.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const currentPage = Math.min(page, totalPages);
    const startIndex = (currentPage - 1) * pageSize;
    const paginatedItems = filteredItems.slice(startIndex, startIndex + pageSize);

    return {
      items: paginatedItems,
      allItems: filteredItems,
      pagination: {
        currentPage,
        totalPages,
        totalItems,
        pageSize,
      },
    };
  }

  private matchesFilters(item: LibraryItemRecord, filters: LibrarySearchFilters) {
    if (filters.namespace && item.namespace !== filters.namespace) {
      return false;
    }
    if (filters.developer && item.developer !== filters.developer) {
      return false;
    }
    if (filters.itemType && item.itemType !== filters.itemType) {
      return false;
    }
    if (filters.status && item.status !== filters.status) {
      return false;
    }
    if (
      filters.category &&
      !item.categories.some((category) => category.path === filters.category)
    ) {
      return false;
    }
    if (
      filters.platform &&
      !item.releaseInfo.some((release) =>
        release.platform.includes(filters.platform as string),
      )
    ) {
      return false;
    }

    return (
      this.matchesBooleanFilter(item.unsearchable, filters.unsearchable) &&
      this.matchesBooleanFilter(item.endOfSupport, filters.endOfSupport) &&
      this.matchesBooleanFilter(
        item.requiresSecureAccount,
        filters.requiresSecureAccount,
      ) &&
      this.matchesBooleanFilter(itemHasStorePage(item), filters.storePage)
    );
  }

  private matchesBooleanFilter(
    value: boolean,
    filter: "all" | "yes" | "no" | undefined,
  ) {
    if (!filter || filter === "all") {
      return true;
    }

    return filter === "yes" ? value : !value;
  }
}

export const librarySyncService = new LibrarySyncService();
