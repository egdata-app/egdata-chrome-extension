import consola from 'consola';
import { EpicGamesGraphQLClient } from '../lib/clients/epic';

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

// Initialize client when extension starts
initializeEpicClient();

// Handle manual activation (when user clicks the extension icon)
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: 'main.html' });
});

// Handle automatic activation when extension is installed or updated
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install' || details.reason === 'update') {
    // Open a tab with Epic Games Store, wait for it to load, then close the tab
    chrome.tabs.create({ url: 'https://store.epicgames.com' }, (tab) => {
      if (tab.id) {
        const tabId = tab.id;
        const listener = (
          updatedTabId: number,
          changeInfo: chrome.tabs.TabChangeInfo,
        ) => {
          if (updatedTabId === tabId && changeInfo.status === 'complete') {
            // Remove the listener first to prevent any race conditions
            chrome.tabs.onUpdated.removeListener(listener);
            // Close the Epic Games Store tab
            chrome.tabs.remove(tabId);
            // Open the main extension page
            chrome.tabs.create({ url: 'main.html' });
          }
        };
        // Add the listener
        chrome.tabs.onUpdated.addListener(listener);
      }
    });
  }
});

// Handle automatic activation when browser starts
chrome.runtime.onStartup.addListener(async () => {
  logger.info('Extension started');
  await initializeEpicClient();
  await chrome.tabs.create({ url: 'main.html' });
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
        if (!epicClient) {
          logger.warn(
            'Epic Games client not initialized, attempting to initialize...',
          );
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
        const library = await epicClient
          .getLibrary({
            ...request.payload,
            token: authCookie.value,
            includeMetadata: true,
          })
          .catch((error) => {
            logger.error('Error fetching Epic Games library:', error);
            throw error;
          });
        logger.info('Library data received, sending response');
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
