import consola from 'consola';
import { EpicGamesGraphQLClient } from '../lib/clients/epic';
import { librarySyncService } from '../lib/services/library-sync';

const logger = consola.withTag('background');

let epicClient: EpicGamesGraphQLClient | null = null;

// Initialize Epic Games client with token from cookie
async function initializeEpicClient() {
  logger.info('Initializing Epic Games client');
  try {
    const authCookie = await chrome.cookies.get({
      name: 'EPIC_EG1',
      url: 'https://store.epicgames.com',
    });

    if (authCookie?.value) {
      epicClient = new EpicGamesGraphQLClient({
        token: authCookie.value,
      });
    } else {
      logger.warn('Epic Games authentication cookie not found');
    }
  } catch (error) {
    logger.error('Failed to initialize Epic Games client:', error);
  }
}

// Fetch library data from Epic Games
async function fetchLibraryData() {
  try {
    if (!epicClient) {
      logger.warn('Epic Games client not initialized, attempting to initialize...');
      await initializeEpicClient();

      if (!epicClient) {
        throw new Error('Failed to initialize Epic Games client');
      }
    }

    const authCookie = await chrome.cookies.get({
      name: 'EPIC_EG1',
      url: 'https://store.epicgames.com',
    });

    if (!authCookie?.value) {
      throw new Error('Epic Games authentication cookie not found');
    }

    logger.info('Fetching library data...');
    const library = await epicClient.getLibrary({
      token: authCookie.value,
      includeMetadata: true,
    });

    return library;
  } catch (error) {
    logger.error('Error fetching library data:', error);
    throw error;
  }
}

// Start periodic sync when extension is activated
async function startLibrarySync() {
  try {
    const library = await fetchLibraryData();
    librarySyncService.startPeriodicSync(library);
  } catch (error) {
    logger.error('Failed to start library sync:', error);
  }
}

// Initialize client and start sync when extension starts
chrome.runtime.onStartup.addListener(async () => {
  logger.info('Extension started');
  await initializeEpicClient();
  await startLibrarySync();
  await chrome.tabs.create({ url: 'main.html' });
});

// Handle manual activation (when user clicks the extension icon)
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: 'main.html' });
});

// Handle automatic activation when extension is installed or updated
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install' || details.reason === 'update') {
    await startLibrarySync();
    chrome.tabs.create({ url: 'main.html' });
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  logger.info('Received message:', request.action, request);

  if (request.action === 'getEpicToken') {
    logger.info('Getting Epic Games token');

    // Return true to indicate we'll send the response asynchronously
    (async () => {
      try {
        const authCookie = await chrome.cookies.get({
          name: 'EPIC_EG1',
          url: 'https://store.epicgames.com',
        });

        if (authCookie?.value) {
          logger.info('Epic Games token found', authCookie);
          sendResponse({ token: authCookie.value });
        } else {
          logger.error('Epic Games authentication cookie not found');
          sendResponse({ error: 'Epic Games authentication cookie not found' });
        }
      } catch (error) {
        logger.error('Error getting Epic Games token:', error);
        sendResponse({ error: 'Failed to get Epic Games token' });
      }
    })();

    return true; // Keep the message channel open for the async response
  }

  if (request.action === 'getLibrary') {
    logger.info('Getting Epic Games library', request.payload);

    // Return true to indicate we'll send the response asynchronously
    (async () => {
      try {
        const library = await fetchLibraryData();
        sendResponse({ library });
      } catch (error) {
        logger.error('Error getting Epic Games library:', error);
        sendResponse({
          error:
            error instanceof Error
              ? error.message
              : 'Failed to get Epic Games library',
        });
      }
    })();

    return true; // Keep the message channel open for the async response
  }
});
