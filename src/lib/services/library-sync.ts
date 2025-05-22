import consola from 'consola';
import { openDB, type IDBPDatabase } from 'idb';
import type { LibraryResponse } from '@/types/get-library';
import type { Item } from '@/types/item';
import { EpicGamesGraphQLClient } from '@/lib/clients/epic';

const logger = consola.withTag('library-sync');

interface BulkResponse {
  items: Record<string, Item>;
}

export class LibrarySyncService {
  private db: IDBPDatabase | null = null;
  private readonly DB_NAME = 'egdata-library';
  private readonly STORE_NAME = 'library-items';
  private readonly SYNC_INTERVAL = 5; // 5 minutes
  private currentLibrary: LibraryResponse | null = null;
  private epicClient: EpicGamesGraphQLClient | null = null;

  constructor() {
    this.initializeDB();
    this.setupAlarmListener();
  }

  private setupAlarmListener() {
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === 'library-sync' && this.currentLibrary) {
        this.syncLibrary(this.currentLibrary).catch((error) => {
          logger.error('Error in alarm sync:', error);
        });
      }
    });
  }

  private async initializeDB() {
    try {
      this.db = await openDB(this.DB_NAME, 1, {
        upgrade(db) {
          if (!db.objectStoreNames.contains('library-items')) {
            db.createObjectStore('library-items', { keyPath: 'id' });
            logger.debug('Created object store: library-items');
          }
        },
      });
      logger.debug('IndexedDB initialized successfully');
    } catch (error) {
      logger.error('Error opening IndexedDB:', error);
      throw error;
    }
  }

  private async saveToIndexedDB(items: Record<string, Item>) {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    try {
      const tx = this.db.transaction(this.STORE_NAME, 'readwrite');
      const store = tx.objectStore(this.STORE_NAME);

      // Clear existing data
      await store.clear();

      // Add new items
      await Promise.all(
        Object.entries(items).map(([, data]) => store.put(data)),
      );

      await tx.done;
      logger.debug('Successfully saved items to IndexedDB');
    } catch (error) {
      logger.error('Error saving to IndexedDB:', error);
      throw error;
    }
  }

  private async fetchBulkData(items: string[]): Promise<BulkResponse> {
    try {
      const BATCH_SIZE = 100;
      const batches = [];

      // Split items into batches of 100
      for (let i = 0; i < items.length; i += BATCH_SIZE) {
        batches.push(items.slice(i, i + BATCH_SIZE));
      }

      // Fetch each batch and combine results
      const results = await Promise.all(
        batches.map(async (batch, index) => {
          logger.debug(`Fetching batch ${index + 1} of ${batches.length}`);

          const response = await fetch(
            'https://api-gcp.egdata.app/items/bulk',
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ items: batch }),
            },
          );

          if (!response.ok) {
            logger.error(`HTTP error! status: ${response.status}`);
            throw new Error(`HTTP error! status: ${response.status}`);
          }

          const json = await response.json();
          logger.debug(`Fetched batch ${index + 1} of ${batches.length}`);

          return json as Item[];
        }),
      );

      // Combine all batch results
      const combinedResults = results.reduce((acc, items) => {
        if (!Array.isArray(items)) {
          logger.warn('Invalid response from bulk API:', items);
          return acc;
        }
        return Object.assign(
          acc,
          Object.fromEntries(items.map((item) => [item.id, item])),
        );
      }, {});

      logger.debug('Combined results', {
        itemCount: Object.keys(combinedResults).length,
      });

      return { items: combinedResults };
    } catch (error) {
      logger.error('Error fetching bulk data:', error);
      throw error;
    }
  }

  private async getEpicClient(): Promise<EpicGamesGraphQLClient> {
    if (!this.epicClient) {
      const authCookie = await chrome.cookies.get({
        name: 'EPIC_EG1',
        url: 'https://store.epicgames.com',
      });

      if (!authCookie?.value) {
        throw new Error('Epic Games authentication cookie not found');
      }

      this.epicClient = new EpicGamesGraphQLClient({
        token: authCookie.value,
      });
    }
    return this.epicClient;
  }

  private async fetchLibraryPage(cursor?: string): Promise<LibraryResponse> {
    try {
      const client = await this.getEpicClient();
      const authCookie = await chrome.cookies.get({
        name: 'EPIC_EG1',
        url: 'https://store.epicgames.com',
      });

      if (!authCookie?.value) {
        throw new Error('Epic Games authentication cookie not found');
      }

      return await client.getLibrary({
        token: authCookie.value,
        includeMetadata: true,
        cursor,
        excludeNs: ['ue'],
      });
    } catch (error) {
      logger.error('Error fetching library page:', error);
      throw error;
    }
  }

  public async syncLibrary(library: LibraryResponse) {
    try {
      logger.info('Starting library sync');

      if (!library?.records) {
        logger.error('Invalid library response:', library);
        throw new Error('Invalid library response: missing records array');
      }

      let allRecords = [...library.records];
      let nextCursor = library.responseMetadata.nextCursor;

      // Fetch all pages
      while (nextCursor) {
        logger.debug('Fetching next page with cursor:', nextCursor);
        const nextPage = await this.fetchLibraryPage(nextCursor);

        if (!nextPage?.records) {
          logger.error('Invalid library response for next page:', nextPage);
          break;
        }

        allRecords = [...allRecords, ...nextPage.records];
        nextCursor = nextPage.responseMetadata.nextCursor;
      }

      logger.info(`Fetched ${allRecords.length} total records`);

      // Extract item IDs from all records
      const itemIds = allRecords
        .map((record) => record.catalogItemId)
        .filter(Boolean);

      if (itemIds.length === 0) {
        logger.warn('No valid item IDs found in library');
        return;
      }

      // Fetch detailed data from bulk API
      const bulkData = await this.fetchBulkData(itemIds);

      // Save to IndexedDB
      await this.saveToIndexedDB(bulkData.items);

      logger.success('Library sync completed successfully');
    } catch (error) {
      logger.error('Error syncing library:', error);
      throw error;
    }
  }

  public startPeriodicSync(library: LibraryResponse) {
    // Store the current library for future syncs
    this.currentLibrary = library;

    // Stop any existing alarm
    this.stopPeriodicSync();

    // Start new sync immediately
    this.syncLibrary(library).catch((error) => {
      logger.error('Error in initial sync:', error);
    });

    // Create a new alarm
    chrome.alarms.create('library-sync', {
      periodInMinutes: this.SYNC_INTERVAL,
    });

    logger.debug('Started periodic library sync with alarms');
  }

  public stopPeriodicSync() {
    chrome.alarms.clear('library-sync');
    this.currentLibrary = null;
    logger.debug('Stopped periodic library sync');
  }

  public async getAllItems() {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    try {
      const tx = this.db.transaction(this.STORE_NAME, 'readonly');
      const store = tx.objectStore(this.STORE_NAME);
      return await store.getAll();
    } catch (error) {
      logger.error('Error getting all items:', error);
      throw error;
    }
  }

  public async getItem(id: string) {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    try {
      const tx = this.db.transaction(this.STORE_NAME, 'readonly');
      const store = tx.objectStore(this.STORE_NAME);
      return await store.get(id);
    } catch (error) {
      logger.error('Error getting item:', error);
      throw error;
    }
  }

  public async searchItems({
    page = 1,
    pageSize = 12,
    searchQuery = '',
    sortBy = 'lastModifiedDate',
    sortOrder = 'desc',
  }: {
    page?: number;
    pageSize?: number;
    searchQuery?: string;
    sortBy?: 'lastModifiedDate' | 'title';
    sortOrder?: 'asc' | 'desc';
  }) {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    try {
      const tx = this.db.transaction(this.STORE_NAME, 'readonly');
      const store = tx.objectStore(this.STORE_NAME);
      const allItems = await store.getAll();

      // Apply search filter
      let filteredItems = allItems;
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        filteredItems = allItems.filter((item) =>
          item.title.toLowerCase().includes(query),
        );
      }

      // Apply sorting
      filteredItems.sort((a, b) => {
        const aValue = a[sortBy];
        const bValue = b[sortBy];

        if (sortOrder === 'asc') {
          return aValue > bValue ? 1 : -1;
        }
        return aValue < bValue ? 1 : -1;
      });

      // Calculate pagination
      const totalItems = filteredItems.length;
      const totalPages = Math.ceil(totalItems / pageSize);
      const startIndex = (page - 1) * pageSize;
      const endIndex = startIndex + pageSize;
      const paginatedItems = filteredItems.slice(startIndex, endIndex);

      return {
        items: paginatedItems,
        pagination: {
          currentPage: page,
          totalPages,
          totalItems,
          pageSize,
        },
      };
    } catch (error) {
      logger.error('Error searching items:', error);
      throw error;
    }
  }
}

export const librarySyncService = new LibrarySyncService();
