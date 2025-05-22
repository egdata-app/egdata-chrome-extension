import consola from 'consola';
import { openDB, type IDBPDatabase } from 'idb';
import { LibraryResponse } from '@/types/get-library';

const logger = consola.withTag('library-sync');

interface BulkResponse {
  items: Record<string, any>;
}

export class LibrarySyncService {
  private db: IDBPDatabase | null = null;
  private readonly DB_NAME = 'egdata-library';
  private readonly STORE_NAME = 'library-items';
  private readonly SYNC_INTERVAL = 5; // 5 minutes
  private currentLibrary: LibraryResponse | null = null;

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
            logger.info('Created object store: library-items');
          }
        },
      });
      logger.info('IndexedDB initialized successfully');
    } catch (error) {
      logger.error('Error opening IndexedDB:', error);
      throw error;
    }
  }

  private async saveToIndexedDB(items: Record<string, any>) {
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
        Object.entries(items).map(([id, data]) => 
          store.put({ id, ...data })
        )
      );

      await tx.done;
      logger.info('Successfully saved items to IndexedDB');
    } catch (error) {
      logger.error('Error saving to IndexedDB:', error);
      throw error;
    }
  }

  private async fetchBulkData(items: string[]): Promise<BulkResponse> {
    try {
      const response = await fetch('https://api.egdata.app/items/bulk', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ items }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      logger.error('Error fetching bulk data:', error);
      throw error;
    }
  }

  public async syncLibrary(library: LibraryResponse) {
    try {
      logger.info('Starting library sync');
      
      // Extract item IDs from the library
      const itemIds = library.items.map(item => item.id);
      
      // Fetch detailed data from bulk API
      const bulkData = await this.fetchBulkData(itemIds);
      
      // Save to IndexedDB
      await this.saveToIndexedDB(bulkData.items);
      
      logger.info('Library sync completed successfully');
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

    logger.info('Started periodic library sync with alarms');
  }

  public stopPeriodicSync() {
    chrome.alarms.clear('library-sync');
    this.currentLibrary = null;
    logger.info('Stopped periodic library sync');
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
}

export const librarySyncService = new LibrarySyncService(); 