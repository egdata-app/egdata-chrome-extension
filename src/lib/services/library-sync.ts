import { EpicGamesGraphQLClient } from '@/lib/clients/epic';
import type {
  LibrarySearchParams,
  LibrarySearchResult,
  LibrarySyncStatus,
} from '@/lib/messages';
import { extractUniqueCatalogItemIds } from '@/lib/services/library-utils';
import type { LibraryResponse } from '@/types/get-library';
import type { Item } from '@/types/item';
import consola from 'consola';
import { type IDBPDatabase, openDB } from 'idb';

const logger = consola.withTag('library-sync');

interface BulkResponse {
  items: Record<string, Item>;
}

const DEFAULT_SYNC_STATUS: LibrarySyncStatus = {
  state: 'idle',
  itemCount: 0,
};

const STATUS_KEY = 'sync-status';

export class LibrarySyncService {
  private dbPromise: Promise<IDBPDatabase>;
  private readonly DB_NAME = 'egdata-library';
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
    return openDB(this.DB_NAME, 2, {
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

  private async setSyncStatus(status: LibrarySyncStatus) {
    const db = await this.getDB();
    const tx = db.transaction(this.META_STORE_NAME, 'readwrite');
    await tx.objectStore(this.META_STORE_NAME).put(status, STATUS_KEY);
    await tx.done;
  }

  public async getSyncStatus(): Promise<LibrarySyncStatus> {
    const db = await this.getDB();
    const status = await db.get(this.META_STORE_NAME, STATUS_KEY);
    const itemCount = await db.count(this.LIBRARY_STORE_NAME);

    return {
      ...DEFAULT_SYNC_STATUS,
      ...(status as Partial<LibrarySyncStatus> | undefined),
      itemCount,
    };
  }

  public async recordSyncFailure(
    error: unknown,
    startedAt = Date.now(),
  ): Promise<LibrarySyncStatus> {
    const previousStatus = await this.getSyncStatus();
    const status: LibrarySyncStatus = {
      ...previousStatus,
      state: 'error',
      startedAt,
      lastError: error instanceof Error ? error.message : String(error),
    };
    await this.setSyncStatus(status);
    return status;
  }

  private async saveToIndexedDB(items: Record<string, Item>) {
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
    await this.setSyncStatus({
      ...(await this.getSyncStatus()),
      state: 'syncing',
      startedAt,
      lastError: undefined,
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
      const bulkData =
        itemIds.length > 0 ? await this.fetchBulkData(itemIds) : { items: {} };

      await this.saveToIndexedDB(bulkData.items);

      const status: LibrarySyncStatus = {
        state: 'success',
        itemCount: Object.keys(bulkData.items).length,
        startedAt,
        lastSyncedAt: Date.now(),
      };
      await this.setSyncStatus(status);
      logger.success('Library sync completed successfully');
      return status;
    } catch (error) {
      await this.recordSyncFailure(error, startedAt);
      logger.error('Error syncing library:', error);
      throw error;
    }
  }

  public async getAllItems(): Promise<Item[]> {
    const db = await this.getDB();
    return db.getAll(this.LIBRARY_STORE_NAME);
  }

  public async getItem(id: string): Promise<Item | undefined> {
    const db = await this.getDB();
    return db.get(this.LIBRARY_STORE_NAME, id);
  }

  public async searchItems({
    page = 1,
    pageSize = 12,
    searchQuery = '',
    sortBy = 'lastModifiedDate',
    sortOrder = 'desc',
  }: LibrarySearchParams = {}): Promise<LibrarySearchResult> {
    const db = await this.getDB();
    const allItems = await db.getAll(this.LIBRARY_STORE_NAME);
    const normalizedPage = Math.max(1, page);
    const normalizedPageSize = Math.max(1, pageSize);
    const normalizedQuery = searchQuery.trim().toLowerCase();

    const filteredItems = normalizedQuery
      ? allItems.filter((item) =>
          item.title.toLowerCase().includes(normalizedQuery),
        )
      : allItems;

    filteredItems.sort((a, b) => {
      const aValue = a[sortBy] ?? '';
      const bValue = b[sortBy] ?? '';

      if (sortOrder === 'asc') {
        return aValue > bValue ? 1 : -1;
      }

      return aValue < bValue ? 1 : -1;
    });

    const totalItems = filteredItems.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / normalizedPageSize));
    const currentPage = Math.min(normalizedPage, totalPages);
    const startIndex = (currentPage - 1) * normalizedPageSize;
    const endIndex = startIndex + normalizedPageSize;

    return {
      items: filteredItems.slice(startIndex, endIndex),
      pagination: {
        currentPage,
        totalPages,
        totalItems,
        pageSize: normalizedPageSize,
      },
    };
  }
}

export const librarySyncService = new LibrarySyncService();
