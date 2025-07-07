import consola from 'consola';
import {
  EpicGamesGraphQLClient,
  getOffersValidation,
} from '@/lib/clients/epic';
import { librarySyncService } from '../lib/services/library-sync';

const logger = consola.withTag('background');

let epicClient: EpicGamesGraphQLClient | null = null;

// Initialize Epic Games client with token from cookie
let isInitializing = false;

async function initializeEpicClient() {
  // Prevent multiple simultaneous initialization attempts
  if (isInitializing) {
    logger.info('Already initializing Epic Games client, skipping');
    return;
  }

  logger.info('Initializing Epic Games client');
  isInitializing = true;

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
      logger.warn(
        'Epic Games authentication cookie not found - user is not logged in',
      );

      logger.info('Opening Epic Games Store for login');
      const tab = await chrome.tabs.create({
        url: 'https://store.epicgames.com',
        pinned: true,
        active: false,
      });
      if (tab.id) {
        const listener = async (
          updatedTabId: number,
          changeInfo: chrome.tabs.TabChangeInfo,
        ) => {
          if (updatedTabId === tab.id && changeInfo.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            chrome.tabs.remove(updatedTabId);
            // Reset initialization flag after tab is closed
            isInitializing = false;
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
      }
    }
  } catch (error) {
    logger.error('Failed to initialize Epic Games client:', error);
  }
}

// Fetch library data from Epic Games
async function fetchLibraryData() {
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
});

// Handle manual activation (when user clicks the extension icon)
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: 'main.html' });
});

// Handle automatic activation when extension is installed or updated
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install' || details.reason === 'update') {
    // Open a tab with Epic Games Store, wait for it to load, then close the tab
    chrome.tabs.create(
      { url: 'https://store.epicgames.com', pinned: true, active: false },
      async (tab) => {
        if (tab.id) {
          const tabId = tab.id;
          const listener = async (
            updatedTabId: number,
            changeInfo: chrome.tabs.TabChangeInfo,
          ) => {
            if (updatedTabId === tabId && changeInfo.status === 'complete') {
              // Remove the listener first to prevent any race conditions
              chrome.tabs.onUpdated.removeListener(listener);
              // Close the Epic Games Store tab
              chrome.tabs.remove(tabId);
              await startLibrarySync();
            }
          };
          // Add the listener
          chrome.tabs.onUpdated.addListener(listener);
        }
      },
    );
  }
});

// Handle Epic Games Store purchase page
chrome.tabs.onUpdated.addListener(async () => {
  /* if (
    changeInfo.status === 'complete' &&
    tab.url?.includes('store.epicgames.com/purchase')
  ) {
    logger.info('Epic Games Store purchase page detected');

    try {
      // Parse URL and extract offers
      const url = new URL(tab.url);
      //`{quantity}-{namespace}-{id}`
      const offers = url.searchParams.getAll('offers').map((offer) => {
        const [, namespace, offerId] = offer.split('-');
        return {
          namespace,
          offerId,
        };
      });

      if (offers.length === 0) {
        logger.warn('No offers found in URL');
        return;
      }

      // Initialize client if needed
      if (!epicClient) {
        await initializeEpicClient();
        if (!epicClient) {
          throw new Error('Failed to initialize Epic Games client');
        }
      }

      // Check offer ownership using the new validation query
      const validationResult = await epicClient.getOffersValidation({
        offers,
      });

      logger.info('Validation result:', {
        fullyOwned:
          validationResult.Entitlements.cartOffersValidation.fullyOwnedOffers
            .length,
        possibleUpgrade:
          validationResult.Entitlements.cartOffersValidation
            .possiblePartialUpgradeOffers.length,
        unableUpgrade:
          validationResult.Entitlements.cartOffersValidation
            .unablePartiallyUpgradeOffers.length,
        totalOffers: offers.length,
      });

      // Get all non-buyable offers
      const nonBuyableOffers = new Set([
        ...validationResult.Entitlements.cartOffersValidation.fullyOwnedOffers.map(
          (offer) => offer.offerId,
        ),
        ...validationResult.Entitlements.cartOffersValidation.possiblePartialUpgradeOffers.map(
          (offer) => offer.offerId,
        ),
        ...validationResult.Entitlements.cartOffersValidation.unablePartiallyUpgradeOffers.map(
          (offer) => offer.offerId,
        ),
        ...validationResult.Entitlements.cartOffersValidation.conflictingOffers.map(
          (offer) => offer.offerId,
        ),
      ]);

      logger.info('Non-buyable offers:', {
        count: nonBuyableOffers.size,
        offers: Array.from(nonBuyableOffers),
      });

      // Filter out non-buyable offers
      const buyableOffers = offers.filter(
        (offer) => !nonBuyableOffers.has(offer.offerId),
      );

      logger.info('Buyable offers:', {
        count: buyableOffers.length,
        offers: buyableOffers.map((o) => `${o.namespace}-${o.offerId}`),
      });

      // If no offers are buyable, redirect to library
      if (buyableOffers.length === 0) {
        logger.info('No buyable offers found, redirecting to library');
        await chrome.tabs.update(tabId, {
          url: 'https://store.epicgames.com',
        });
        return;
      }

      // If some offers are not buyable, create new URL without them
      if (buyableOffers.length < offers.length) {
        logger.info(
          `Filtering out ${offers.length - buyableOffers.length} non-buyable offers`,
          {
            originalCount: offers.length,
            buyableCount: buyableOffers.length,
            removedCount: offers.length - buyableOffers.length,
          },
        );
        const newUrl = new URL('https://store.epicgames.com/purchase');
        for (const offer of buyableOffers) {
          newUrl.searchParams.append(
            'offers',
            `1-${offer.namespace}-${offer.offerId}`,
          );
        }

        // Preserve the hash fragment if it exists
        if (url.hash) {
          newUrl.hash = url.hash;
        }

        await chrome.tabs.update(tabId, { url: newUrl.toString() });
      }
    } catch (error) {
      logger.error('Error processing purchase page:', error);
    }
  } */
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

  if (request.action === 'syncLibrary') {
    logger.info('Manual library sync requested');

    // Return true to indicate we'll send the response asynchronously
    (async () => {
      try {
        const library = await fetchLibraryData();
        await librarySyncService.syncLibrary(library);
        sendResponse({ success: true });
      } catch (error) {
        logger.error('Error during manual library sync:', error);
        sendResponse({
          error:
            error instanceof Error ? error.message : 'Failed to sync library',
        });
      }
    })();

    return true; // Keep the message channel open for the async response
  }

  if (request.action === 'getOwnedSlugs') {
    logger.info('Processing getOwnedSlugs request', request.payload);

    (async () => {
      try {
        const slugs: string[] = request.payload?.slugs;
        if (!slugs || !Array.isArray(slugs) || slugs.length === 0) {
          logger.warn('No slugs provided for getOwnedSlugs');
          sendResponse({ ownedSlugs: [], error: 'No slugs provided' });
          return;
        }

        // Step 1: Fetch offer details (ID including namespace) from egdata.app
        const egdataResponse = await fetch(
          'https://api-gcp.egdata.app/offers/slugs',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ slugs }),
          },
        );

        if (!egdataResponse.ok) {
          const errorText = await egdataResponse.text();
          logger.error(
            'Failed to fetch offer IDs from egdata.app:',
            egdataResponse.status,
            errorText,
          );
          sendResponse({
            ownedSlugs: [],
            error: `Failed to fetch offer IDs from egdata.app: ${egdataResponse.status}`,
          });
          return;
        }

        const offerMappingsFromEgdata: Array<{
          slug: string;
          id: string | null;
          namespace: string | null;
        }> = await egdataResponse.json();
        logger.info(
          'Received offer ID mappings from egdata.app:',
          offerMappingsFromEgdata,
        );

        // Step 3: Initialize Epic client if needed
        if (!epicClient) {
          await initializeEpicClient();
          if (!epicClient) {
            logger.error(
              'Failed to initialize Epic Games client for ownership check',
            );
            sendResponse({
              ownedSlugs: [],
              error: 'Failed to initialize Epic Games client',
            });
            return;
          }
        }

        // Step 4: Check ownership with Epic Games
        const epicOffersPayload = offerMappingsFromEgdata
          .filter((o) => o.id && o.namespace)
          .map((o) => ({
            namespace: o.namespace,
            offerId: o.id,
          })) as { namespace: string; offerId: string }[];

        const validationResult = await epicClient.getOffersValidation({
          offers: epicOffersPayload,
        });

        logger.info(
          'Epic ownership validation result:',
          validationResult.Entitlements.cartOffersValidation.fullyOwnedOffers,
        );

        // Step 5: Identify owned slugs
        const ownedEpicOffersSet = new Set(
          validationResult.Entitlements.cartOffersValidation.fullyOwnedOffers.map(
            (ownedOffer: { offerId: string; namespace: string }) =>
              `${ownedOffer.namespace}-${ownedOffer.offerId}`,
          ),
        );

        const ownedSlugsResult = offerMappingsFromEgdata
          .filter((o) => o.id && o.namespace)
          .filter((o) => ownedEpicOffersSet.has(`${o.namespace}-${o.id}`))
          .map((o) => o.slug);

        logger.info('Owned slugs determined:', ownedSlugsResult);
        sendResponse({
          ownedSlugs: ownedSlugsResult,
          offerMappings: offerMappingsFromEgdata,
        });
      } catch (error) {
        logger.error('Error processing getOwnedSlugs:', error);
        sendResponse({
          ownedSlugs: [],
          error:
            error instanceof Error
              ? error.message
              : 'Unknown error processing getOwnedSlugs',
        });
      }
    })();
    return true; // Keep the message channel open for the async response
  }

  /**
   * Same logic as getOwnedSlugs, but we don't need to fetch offer IDs as they are already in the request.payload
   */
  if (request.action === 'getOwnedOffers') {
    logger.info('Processing getOwnedOffers request', request.payload);

    (async () => {
      try {
        const offers = request.payload?.offers;
        if (!offers || !Array.isArray(offers) || offers.length === 0) {
          logger.warn('No offers provided for getOwnedOffers');
          sendResponse({ ownedOffers: [], error: 'No offers provided' });
          return;
        }

        const authCookie = await chrome.cookies.get({
          name: 'EPIC_EG1',
          url: 'https://store.epicgames.com',
        });

        if (!authCookie) {
          logger.error('No Epic Games authentication cookie found');
          sendResponse({
            ownedOffers: [],
            error: 'No Epic Games authentication cookie found',
          });
          return;
        }

        logger.info('Epic Games authentication cookie found', authCookie);

        const validationResult = await getOffersValidation(
          offers,
          authCookie.value,
        );

        logger.info(
          'Epic ownership validation result:',
          validationResult.fullyOwnedOffers,
        );

        const ownedEpicOffersSet = new Set(
          validationResult.fullyOwnedOffers.map(
            (ownedOffer: { offerId: string; namespace: string }) =>
              `${ownedOffer.namespace}-${ownedOffer.offerId}`,
          ),
        );

        const ownedOffersResult = offers.filter((o) =>
          ownedEpicOffersSet.has(`${o.namespace}-${o.offerId}`),
        );

        logger.info('Owned offers determined:', ownedOffersResult);
        sendResponse({ ownedOffers: ownedOffersResult });
      } catch (error) {
        logger.error('Error processing getOwnedOffers:', error);
        sendResponse({
          ownedOffers: [],
          error:
            error instanceof Error
              ? error.message
              : 'Unknown error processing getOwnedOffers',
        });
      }
    })();
    return true; // Keep the message channel open for the async response
  }
});

chrome.runtime.onMessageExternal.addListener(
  (request, sender, sendResponse) => {
    if (request.action === 'getOwnedOffers') {
      logger.info(
        'Processing EXTERNAL getOwnedOffers request',
        request.payload,
      );
      (async () => {
        try {
          const offers: { namespace: string; id: string }[] =
            request.payload?.offers;
          if (!offers || !Array.isArray(offers) || offers.length === 0) {
            logger.warn('No offers provided for getOwnedOffers');
            sendResponse({ ownedOffers: [], error: 'No offers provided' });
            return;
          }

          const authCookie = await chrome.cookies.get({
            name: 'EPIC_EG1',
            url: 'https://store.epicgames.com',
          });
          if (!authCookie) {
            logger.error('No Epic Games authentication cookie found');
            sendResponse({
              ownedOffers: [],
              error: 'No Epic Games authentication cookie found',
            });
            return;
          }

          const validationResult = await getOffersValidation(
            offers,
            authCookie.value,
          );

          // Combine fullyOwnedOffers and conflictingOffers as owned
          const fullyOwned = validationResult.fullyOwnedOffers ?? [];

          const ownedEpicOffersSet = new Set(
            fullyOwned.map((o) => `${o.namespace}-${o.offerId}`),
          );

          const ownedOffersResult = offers.filter(
            (o: { namespace: string; id: string }) =>
              ownedEpicOffersSet.has(`${o.namespace}-${o.id}`),
          );

          logger.info('Owned offers determined (external):', ownedOffersResult);
          logger.info('Fully owned offers:', fullyOwned);

          logger.info('Owned offers determined (external):', ownedOffersResult);
          sendResponse({ ownedOffers: ownedOffersResult });
        } catch (error) {
          logger.error('Error processing EXTERNAL getOwnedOffers:', error);
          sendResponse({
            ownedOffers: [],
            error:
              error instanceof Error
                ? error.message
                : 'Unknown error processing getOwnedOffers',
          });
        }
      })();
      return true;
    }
    // Optionally, support getOwnedSlugs for external as well
    if (request.action === 'getOwnedSlugs') {
      logger.info('Processing EXTERNAL getOwnedSlugs request', request.payload);
      (async () => {
        try {
          const slugs: string[] = request.payload?.slugs;
          if (!slugs || !Array.isArray(slugs) || slugs.length === 0) {
            logger.warn('No slugs provided for getOwnedSlugs');
            sendResponse({ ownedSlugs: [], error: 'No slugs provided' });
            return;
          }
          const egdataResponse = await fetch(
            'https://api-gcp.egdata.app/offers/slugs',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ slugs }),
            },
          );
          if (!egdataResponse.ok) {
            const errorText = await egdataResponse.text();
            logger.error(
              'Failed to fetch offer IDs from egdata.app:',
              egdataResponse.status,
              errorText,
            );
            sendResponse({
              ownedSlugs: [],
              error: `Failed to fetch offer IDs from egdata.app: ${egdataResponse.status}`,
            });
            return;
          }
          const offerMappingsFromEgdata: Array<{
            slug: string;
            id: string | null;
            namespace: string | null;
          }> = await egdataResponse.json();
          logger.info(
            'Received offer ID mappings from egdata.app (external):',
            offerMappingsFromEgdata,
          );
          if (!epicClient) {
            await initializeEpicClient();
            if (!epicClient) {
              logger.error(
                'Failed to initialize Epic Games client for ownership check',
              );
              sendResponse({
                ownedSlugs: [],
                error: 'Failed to initialize Epic Games client',
              });
              return;
            }
          }
          const epicOffersPayload = offerMappingsFromEgdata
            .filter(
              (o: {
                slug: string;
                id: string | null;
                namespace: string | null;
              }) => o.id && o.namespace,
            )
            .map(
              (o: {
                slug: string;
                id: string | null;
                namespace: string | null;
              }) => ({
                namespace: o.namespace as string,
                offerId: o.id as string,
              }),
            );
          const validationResult = await epicClient.getOffersValidation({
            offers: epicOffersPayload,
          });
          logger.info(
            'Epic ownership validation result (external):',
            validationResult.Entitlements.cartOffersValidation.fullyOwnedOffers,
          );
          const ownedEpicOffersSet = new Set(
            validationResult.Entitlements.cartOffersValidation.fullyOwnedOffers.map(
              (ownedOffer: { offerId: string; namespace: string }) =>
                `${ownedOffer.namespace}-${ownedOffer.offerId}`,
            ),
          );
          const ownedSlugsResult = offerMappingsFromEgdata
            .filter(
              (o: {
                slug: string;
                id: string | null;
                namespace: string | null;
              }) => o.id && o.namespace,
            )
            .filter(
              (o: {
                slug: string;
                id: string | null;
                namespace: string | null;
              }) => ownedEpicOffersSet.has(`${o.namespace}-${o.id}`),
            )
            .map(
              (o: {
                slug: string;
                id: string | null;
                namespace: string | null;
              }) => o.slug,
            );
          logger.info('Owned slugs determined (external):', ownedSlugsResult);
          sendResponse({
            ownedSlugs: ownedSlugsResult,
            offerMappings: offerMappingsFromEgdata,
          });
        } catch (error) {
          logger.error('Error processing EXTERNAL getOwnedSlugs:', error);
          sendResponse({
            ownedSlugs: [],
            error:
              error instanceof Error
                ? error.message
                : 'Unknown error processing getOwnedSlugs',
          });
        }
      })();
      return true;
    }

    if (request.action === 'getEpicToken') {
      logger.info('Processing EXTERNAL getEpicToken request', request.payload);
      (async () => {
        try {
          const authCookie = await chrome.cookies.get({
            name: 'EPIC_EG1',
            url: 'https://store.epicgames.com',
          });
          if (!authCookie) {
            logger.error('No Epic Games authentication cookie found');
            sendResponse({
              error: 'No Epic Games authentication cookie found',
            });
            return;
          }
          logger.info('Epic Games authentication cookie found', authCookie);
          sendResponse({ token: authCookie.value });
        } catch (error) {
          logger.error('Error processing EXTERNAL getEpicToken:', error);
          sendResponse({
            error:
              error instanceof Error
                ? error.message
                : 'Unknown error processing getEpicToken',
          });
        }
      })();
      return true;
    }
  },
);
