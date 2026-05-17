import { EpicGamesGraphQLClient } from '@/lib/clients/epic';
import { itemHasStorePage } from '@/lib/offer-utils';
import { extractUniqueCatalogItemIds } from '@/lib/services/library-utils';
import type { SyncMetadata } from '@/types/egdata';
import type {
  Record as LibraryRecord,
  LibraryResponse,
} from '@/types/get-library';
import type { Item } from '@/types/item';
import consola from 'consola';
import { type IDBPDatabase, openDB } from 'idb';

const logger = consola.withTag('library-sync');

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
  unsearchable?: 'all' | 'yes' | 'no';
  endOfSupport?: 'all' | 'yes' | 'no';
  requiresSecureAccount?: 'all' | 'yes' | 'no';
  storePage?: 'all' | 'yes' | 'no';
}

export interface LibrarySearchParams {
  page?: number;
  pageSize?: number;
  searchQuery?: string;
  sortBy?: 'lastModifiedDate' | 'title' | 'acquisitionDate' | 'developer';
  sortOrder?: 'asc' | 'desc';
  filters?: LibrarySearchFilters;
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

export interface LibraryFilterOptions {
  namespaces: string[];
  developers: string[];
  itemTypes: string[];
  statuses: string[];
  categories: string[];
  platforms: string[];
}

export interface LibrarySyncStatus {
  state: 'idle' | 'syncing' | 'success' | 'error';
  itemCount: number;
  startedAt?: number;
  lastSyncedAt?: number;
  lastError?: string;
}

const STATUS_KEY = 'sync-status';
const DEFAULT_SYNC_STATUS: LibrarySyncStatus = {
  state: 'idle',
  itemCount: 0,
};

const DEFAULT_SYNC_METADATA: SyncMetadata = {
  status: 'idle',
  totalItems: 0,
  addedItemIds: [],
  removedItemIds: [],
  updatedItemIds: [],
  lastError: null,
};

export class LibrarySyncService {
  private dbPromise: Promise<IDBPDatabase>;
  private readonly DB_NAME = 'egdata-library';
  private readonly DB_VERSION = 3;
  private readonly LIBRARY_STORE_NAME = 'library-items';
  private readonly META_STORE_NAME = 'sync-meta';
  private epicClient: EpicGamesGraphQLClient | null = null;
  private epicClientToken: string | null = null;

  constructor() {
    this.dbPromise = this.initializeDB();
  }

  resetEpicClient() {
    this.epicClient = null;
    this.epicClientToken = null;
  }

  private async initializeDB() {
    return openDB(this.DB_NAME, this.DB_VERSION, {
      upgrade: (db) => {
        if (!db.objectStoreNames.contains(this.LIBRARY_STORE_NAME)) {
          db.createObjectStore(this.LIBRARY_STORE_NAME, { keyPath: 'id' });
        }

        if (!db.objectStoreNames.contains(this.META_STORE_NAME)) {
          db.createObjectStore(this.META_STORE_NAME);
        }
      },
    });
  }

  private async getDB() {
    return this.dbPromise;
  }

  private async saveSyncMetadata(metadata: SyncMetadata) {
    const db = await this.getDB();
    const tx = db.transaction(this.META_STORE_NAME, 'readwrite');
    await tx.objectStore(this.META_STORE_NAME).put(metadata, STATUS_KEY);
    await tx.done;
  }

  public async getSyncMetadata(): Promise<SyncMetadata> {
    const db = await this.getDB();
    const stored = await db.get(this.META_STORE_NAME, STATUS_KEY);
    const itemCount = await db.count(this.LIBRARY_STORE_NAME);

    if (!stored) {
      return {
        ...DEFAULT_SYNC_METADATA,
        totalItems: itemCount,
      };
    }

    const value = stored as Partial<SyncMetadata> & Partial<LibrarySyncStatus>;
    if (value.status) {
      return {
        ...DEFAULT_SYNC_METADATA,
        ...value,
        totalItems: value.totalItems ?? itemCount,
        lastError: value.lastError ?? null,
      };
    }

    return {
      status: value.state ?? 'idle',
      lastStartedAt: value.startedAt
        ? new Date(value.startedAt).toISOString()
        : undefined,
      lastCompletedAt: value.lastSyncedAt
        ? new Date(value.lastSyncedAt).toISOString()
        : undefined,
      lastError: value.lastError ?? null,
      totalItems: value.itemCount ?? itemCount,
      addedItemIds: [],
      removedItemIds: [],
      updatedItemIds: [],
    };
  }

  public async getSyncStatus(): Promise<LibrarySyncStatus> {
    const metadata = await this.getSyncMetadata();
    const db = await this.getDB();
    const itemCount = await db.count(this.LIBRARY_STORE_NAME);

    return {
      ...DEFAULT_SYNC_STATUS,
      state: metadata.status,
      itemCount: metadata.totalItems || itemCount,
      startedAt: toTimestamp(metadata.lastStartedAt),
      lastSyncedAt: toTimestamp(metadata.lastCompletedAt),
      lastError: metadata.lastError ?? undefined,
    };
  }

  public async recordSyncFailure(
    error: unknown,
    startedAt = Date.now(),
  ): Promise<LibrarySyncStatus> {
    const previousMetadata = await this.getSyncMetadata();
    await this.saveSyncMetadata({
      ...previousMetadata,
      status: 'error',
      lastStartedAt:
        previousMetadata.lastStartedAt ?? new Date(startedAt).toISOString(),
      lastError: error instanceof Error ? error.message : String(error),
    });

    return this.getSyncStatus();
  }

  private async saveToIndexedDB(items: Record<string, LibraryItemRecord>) {
    const db = await this.getDB();
    const tx = db.transaction(this.LIBRARY_STORE_NAME, 'readwrite');
    const store = tx.objectStore(this.LIBRARY_STORE_NAME);

    await store.clear();
    await Promise.all(Object.values(items).map((item) => store.put(item)));
    await tx.done;
  }

  private async fetchBulkData(items: string[]): Promise<BulkResponse> {
    const BATCH_SIZE = 100;
    const batches: string[][] = [];

    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      batches.push(items.slice(i, i + BATCH_SIZE));
    }

    const results = await Promise.all(
      batches.map(async (batch, index) => {
        logger.debug(`Fetching item batch ${index + 1} of ${batches.length}`);

        const response = await fetch('https://api-gcp.egdata.app/items/bulk', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ items: batch }),
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch item batch: ${response.status}`);
        }

        return response.json() as Promise<Item[]>;
      }),
    );

    const combinedResults = results.reduce<Record<string, Item>>(
      (acc, items) => {
        if (!Array.isArray(items)) {
          logger.warn('Invalid response from bulk API');
          return acc;
        }

        for (const item of items) {
          acc[item.id] = item;
        }

        return acc;
      },
      {},
    );

    return { items: combinedResults };
  }

  private async getEpicClient(): Promise<EpicGamesGraphQLClient> {
    const token = await this.getEpicToken();

    if (!this.epicClient || this.epicClientToken !== token) {
      this.epicClient = new EpicGamesGraphQLClient({ token });
      this.epicClientToken = token;
    }

    return this.epicClient;
  }

  private async getEpicToken(): Promise<string> {
    const authCookie = await chrome.cookies.get({
      name: 'EPIC_EG1',
      url: 'https://store.epicgames.com',
    });

    if (!authCookie?.value) {
      throw new Error('Epic Games authentication cookie not found');
    }

    return authCookie.value;
  }

  private async fetchLibraryPage(cursor?: string): Promise<LibraryResponse> {
    const client = await this.getEpicClient();
    const token = await this.getEpicToken();

    return client.getLibrary({
      token,
      includeMetadata: true,
      cursor,
      excludeNs: ['ue'],
    });
  }

  public async syncLibrary(
    library: LibraryResponse,
  ): Promise<LibrarySyncStatus> {
    const startedAt = Date.now();
    const startedAtIso = new Date(startedAt).toISOString();
    await this.saveSyncMetadata({
      ...(await this.getSyncMetadata()),
      status: 'syncing',
      lastStartedAt: startedAtIso,
      lastError: null,
    });

    try {
      logger.info('Starting library sync');

      if (!library?.records) {
        throw new Error('Invalid library response: missing records array');
      }

      let allRecords = [...library.records];
      let nextCursor = library.responseMetadata?.nextCursor;

      while (nextCursor) {
        const nextPage = await this.fetchLibraryPage(nextCursor);

        if (!nextPage?.records) {
          throw new Error('Invalid library response for next page');
        }

        allRecords = [...allRecords, ...nextPage.records];
        nextCursor = nextPage.responseMetadata?.nextCursor;
      }

      const itemIds = extractUniqueCatalogItemIds(allRecords);
      const currentItems = await this.getAllItems();
      const currentItemsById = new Map(
        currentItems.map((item) => [item.id, item]),
      );
      const currentItemIds = new Set(currentItemsById.keys());
      const newItemIds = new Set(itemIds);
      const addedItemIds = itemIds.filter((id) => !currentItemIds.has(id));
      const removedItemIds = Array.from(currentItemIds).filter(
        (id) => !newItemIds.has(id),
      );
      const bulkData =
        itemIds.length > 0 ? await this.fetchBulkData(itemIds) : { items: {} };
      const recordsByItemId = getRecordsByItemId(allRecords);
      const seenAt = new Date().toISOString();

      const itemsWithOwnership = Object.fromEntries(
        Object.entries(bulkData.items).map(([id, item]) => {
          const record = recordsByItemId.get(id);
          const previous = currentItemsById.get(id);
          return [
            id,
            {
              ...item,
              acquisitionDate:
                record?.acquisitionDate ?? previous?.acquisitionDate,
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
        status: 'success',
        lastStartedAt: startedAtIso,
        lastCompletedAt: new Date().toISOString(),
        lastError: null,
        totalItems: Object.keys(itemsWithOwnership).length,
        addedItemIds,
        removedItemIds,
        updatedItemIds,
      });

      logger.success('Library sync completed successfully');
      return this.getSyncStatus();
    } catch (error) {
      await this.recordSyncFailure(error, startedAt);
      logger.error('Error syncing library:', error);
      throw error;
    }
  }

  public async getAllItems(): Promise<LibraryItemRecord[]> {
    const db = await this.getDB();
    return db.getAll(this.LIBRARY_STORE_NAME) as Promise<LibraryItemRecord[]>;
  }

  public async getItem(id: string): Promise<LibraryItemRecord | undefined> {
    const db = await this.getDB();
    return db.get(this.LIBRARY_STORE_NAME, id) as Promise<
      LibraryItemRecord | undefined
    >;
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

  public async getFilterOptions(): Promise<LibraryFilterOptions> {
    const items = await this.getAllItems();
    const values = <T>(
      getter: (item: LibraryItemRecord) => T | T[] | undefined,
    ) =>
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
    searchQuery = '',
    sortBy = 'lastModifiedDate',
    sortOrder = 'desc',
    filters = {},
  }: LibrarySearchParams = {}): Promise<LibrarySearchResult> {
    const allItems = await this.getAllItems();
    const normalizedPage = Math.max(1, page);
    const normalizedPageSize = Math.max(1, pageSize);
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
      const aValue = String(a[sortBy] ?? '');
      const bValue = String(b[sortBy] ?? '');
      const result = aValue.localeCompare(bValue);
      return sortOrder === 'asc' ? result : -result;
    });

    const totalItems = filteredItems.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / normalizedPageSize));
    const currentPage = Math.min(normalizedPage, totalPages);
    const startIndex = (currentPage - 1) * normalizedPageSize;

    return {
      items: filteredItems.slice(startIndex, startIndex + normalizedPageSize),
      allItems: filteredItems,
      pagination: {
        currentPage,
        totalPages,
        totalItems,
        pageSize: normalizedPageSize,
      },
    };
  }

  private matchesFilters(
    item: LibraryItemRecord,
    filters: LibrarySearchFilters,
  ) {
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
    filter: 'all' | 'yes' | 'no' | undefined,
  ) {
    if (!filter || filter === 'all') {
      return true;
    }

    return filter === 'yes' ? value : !value;
  }
}

function getRecordsByItemId(records: LibraryRecord[]) {
  const recordsByItemId = new Map<string, LibraryRecord>();
  for (const record of records) {
    if (record.catalogItemId && !recordsByItemId.has(record.catalogItemId)) {
      recordsByItemId.set(record.catalogItemId, record);
    }
  }
  return recordsByItemId;
}

function toTimestamp(value?: string) {
  if (!value) {
    return undefined;
  }

  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? undefined : timestamp;
}

export const librarySyncService = new LibrarySyncService();
