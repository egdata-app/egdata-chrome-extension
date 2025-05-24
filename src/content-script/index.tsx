import consola from "consola";
import { createRoot } from "react-dom/client";
import { openDB, type IDBPDatabase } from "idb";
import { OwnedIndicator } from "./OwnedIndicator";
import "./styles.css";

const logger = consola.withTag("content-script");

interface OfferCard {
  element: Element;
  slug: string;
  uniqueId?: string;
}

interface OfferData {
  id: string | null;
  namespace: string | null;
  offerId: string | null;
  isOwned: boolean;
  lastChecked: number;
}

const offerCards: OfferCard[] = [];

// IndexedDB configuration
const DB_NAME = "egdata-offer-db";
const DB_VERSION = 1;
const STORE_NAME = "offers";

// Initialize IndexedDB
async function initDB(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "slug" });
        logger.info("Created object store:", STORE_NAME);
      }
    },
  });
}

async function saveOfferDataToDB(data: Record<string, OfferData>) {
  const db = await initDB();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);

  await Promise.all(
    Object.entries(data).map(([slug, offerData]) =>
      store.put({ ...offerData, slug })
    )
  );

  await tx.done;
}

async function getCachedOfferData(
  slug: string
): Promise<OfferData | undefined> {
  const db = await initDB();
  return db.get(STORE_NAME, slug);
}

async function updateCachedOfferData(slug: string, data: Partial<OfferData>) {
  const existingData = await getCachedOfferData(slug);
  const updatedData: OfferData = {
    id: existingData?.id ?? null,
    namespace: existingData?.namespace ?? null,
    offerId: existingData?.offerId ?? null,
    isOwned: existingData?.isOwned ?? false,
    lastChecked: Date.now(),
    ...data,
  };
  await saveOfferDataToDB({ [slug]: updatedData });
}

// Function to add owned indicator to a card
function addOwnedIndicator(card: Element, slug: string) {
  if (card.querySelector(".egdata-owned-indicator")) return;

  // Add a data attribute to track which card this is
  const uniqueId = `${slug}-${Date.now()}`;
  (card as HTMLElement).dataset.egdataCardId = uniqueId;

  const indicator = document.createElement("div");
  indicator.className = "egdata-owned-indicator";
  indicator.dataset.egdataCardId = uniqueId;
  (card as HTMLElement).style.position = "relative";
  indicator.style.position = "absolute";
  indicator.style.top = "0";
  indicator.style.left = "0";
  indicator.style.zIndex = "10";
  card.appendChild(indicator);

  createRoot(indicator).render(<OwnedIndicator />);
}

// Function to process owned slugs and update UI
async function processOwnedSlugs(
  ownedSlugs: string[],
  currentCards: OfferCard[] = [],
  checkedSlugs: string[] = []
) {
  logger.info(
    "Processing owned slugs:",
    ownedSlugs,
    "for checked slugs:",
    checkedSlugs
  );

  // Create a Set for faster lookups
  const ownedSlugsSet = new Set(ownedSlugs);
  const checkedSlugsSet = new Set(checkedSlugs);

  // Only process current cards, don't use the global offerCards array
  const cardsToProcess = currentCards;

  // Update cache with owned status for all checked slugs
  for (const card of cardsToProcess) {
    // Only update cache if this slug was actually checked
    if (checkedSlugsSet.has(card.slug)) {
      const isOwned = ownedSlugsSet.has(card.slug);
      logger.debug(
        "Updating cache for checked slug:",
        card.slug,
        "isOwned:",
        isOwned
      );
      await updateCachedOfferData(card.slug, { isOwned });
    }

    // Always add indicator if owned, regardless of whether we checked it
    if (ownedSlugsSet.has(card.slug)) {
      logger.info("Adding owned indicator to card:", card.slug, card.element);
      addOwnedIndicator(card.element, card.slug);
    }
  }
}

async function findAndProcessOfferCards(): Promise<void> {
  logger.info("Searching for offer cards on:", window.location.href);
  const currentOfferCardsThisRun: OfferCard[] = [];
  const slugsToCheck: string[] = [];
  const ownedSlugs: string[] = [];

  // Search for all types of offer cards
  const cards = document.querySelectorAll(
    '[data-component="DiscoverOfferCard"], [data-component="BrowseOfferCard"], [data-component="VaultOfferCard"], a[href*="/p/"]'
  );
  for (const card of Array.from(cards)) {
    // If the card is an anchor tag itself, use it directly
    // Otherwise, find the anchor tag within the card
    const link =
      card instanceof HTMLAnchorElement
        ? card
        : card.querySelector('a[href*="/p/"]');
    if (link) {
      // Check if the link contains an image
      const hasImage = link.querySelector("img") !== null;
      if (!hasImage) continue;

      const href = link.getAttribute("href");
      if (href?.includes("/p/")) {
        const slug = href.split("/p/")[1].split("?")[0];
        // For anchor tags, we need to find the closest card-like container
        const cardElement =
          card instanceof HTMLAnchorElement
            ? card.closest('div[class*="css-"]')
            : card;
        if (cardElement) {
          // Check if this card already has an indicator
          const existingIndicator = cardElement.querySelector(
            ".egdata-owned-indicator"
          );
          if (existingIndicator) {
            // Get the card's current ID
            const cardId = cardElement.getAttribute("data-egdata-card-id");
            // If the card has an ID that doesn't match the current slug, remove the indicator
            if (!cardId || !cardId.startsWith(slug)) {
              logger.info("Removing invalid indicator for card:", cardElement);
              existingIndicator.remove();
            } else {
              // Indicator is valid, skip this card
              continue;
            }
          }

          const offerCard = { element: cardElement, slug };

          // Add to global list, avoiding duplicates
          if (
            !offerCards.some(
              (oc) => oc.element === cardElement && oc.slug === slug
            )
          ) {
            offerCards.push(offerCard);
          }

          // Add to this run's list, avoiding duplicates
          if (
            !currentOfferCardsThisRun.some(
              (oc) => oc.slug === slug && oc.element === cardElement
            )
          ) {
            currentOfferCardsThisRun.push(offerCard);
          }

          // Always check cache for owned status
          const cachedData = await getCachedOfferData(slug);
          logger.debug("Cache data for", slug, ":", cachedData);

          if (cachedData?.isOwned) {
            logger.debug(
              "Found cached owned status for:",
              slug,
              "with data:",
              cachedData
            );
            ownedSlugs.push(slug);
          } else {
            // Only check with background script if we don't have cached data or it's expired
            const CACHE_DURATION = 1000 * 60 * 60; // 1 hour
            const isExpired =
              cachedData &&
              Date.now() - cachedData.lastChecked > CACHE_DURATION;
            logger.debug("Cache status for", slug, ":", {
              hasCache: !!cachedData,
              isExpired,
              lastChecked: cachedData?.lastChecked,
              currentTime: Date.now(),
              timeDiff: cachedData ? Date.now() - cachedData.lastChecked : null,
            });

            if (!cachedData || isExpired) {
              logger.debug(
                "Adding to check list:",
                slug,
                "because:",
                !cachedData ? "no cache" : "cache expired"
              );
              slugsToCheck.push(slug);
            } else {
              logger.debug(
                "Skipping check for",
                slug,
                "because cache is valid and not owned"
              );
            }
          }
        }
      }
    }
  }

  logger.debug(
    `Total unique offer cards stored globally: ${offerCards.length}`
  );

  if (currentOfferCardsThisRun.length > 0) {
    const slugsThisRun = currentOfferCardsThisRun.map((oc) => oc.slug);
    logger.debug("Slugs found in this run:", slugsThisRun);

    // Process any owned slugs we found in cache immediately
    if (ownedSlugs.length > 0) {
      logger.debug("Processing cached owned slugs:", ownedSlugs);
      await processOwnedSlugs(ownedSlugs, currentOfferCardsThisRun, ownedSlugs);
    } else {
      logger.debug("No cached owned slugs found.");
    }

    if (slugsToCheck.length > 0) {
      logger.debug("Checking ownership for slugs:", slugsToCheck);
      // Send slugs to background script to check ownership
      chrome.runtime.sendMessage(
        {
          action: "getOwnedSlugs",
          payload: { slugs: slugsToCheck },
        },
        async (response) => {
          if (chrome.runtime.lastError) {
            logger.error(
              "Error sending message to background script:",
              chrome.runtime.lastError.message
            );
            return;
          }
          if (response.error) {
            logger.error(
              "Error getting owned slugs from background:",
              response.error
            );
          } else {
            logger.info(
              "Owned slugs received from background:",
              response.ownedSlugs
            );

            // Store offer mappings in cache
            if (response.offerMappings) {
              for (const mapping of response.offerMappings) {
                await updateCachedOfferData(mapping.slug, {
                  id: mapping.id,
                  namespace: mapping.namespace,
                  offerId: mapping.id, // The offerId is the same as the id in this case
                });
              }
            }

            await processOwnedSlugs(
              response.ownedSlugs,
              currentOfferCardsThisRun,
              slugsToCheck
            );
          }
        }
      );
    }
  } else {
    logger.info("No new offer card slugs found in this run.");
  }
}

// Function to clear the offerCards array
function clearOfferCards() {
  // Remove all indicators from the DOM
  const indicators = document.querySelectorAll(".egdata-owned-indicator");
  for (const indicator of Array.from(indicators)) {
    indicator.remove();
  }

  // Clear the array
  offerCards.length = 0;
  logger.info("Cleared offerCards array and removed indicators from DOM");
}

// Track URL changes for client-side navigation
let lastUrl = window.location.href;
function checkUrlChange() {
  const currentUrl = window.location.href;
  if (currentUrl !== lastUrl) {
    logger.info("URL changed from", lastUrl, "to", currentUrl);
    lastUrl = currentUrl;
    // Add 1 second delay before clearing and processing cards
    setTimeout(() => {
      clearOfferCards();
      findAndProcessOfferCards().catch((error) => {
        logger.error("Error processing offer cards:", error);
      });
    }, 1000);
  }
}

// Set up URL change detection
function setupUrlChangeDetection() {
  // Check for URL changes periodically
  setInterval(checkUrlChange, 1000);

  // Also check when history changes (for pushState/replaceState)
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  history.pushState = function (
    state: unknown,
    unused: string,
    url?: string | URL | null
  ) {
    originalPushState.call(this, state, unused, url);
    checkUrlChange();
  };

  history.replaceState = function (
    state: unknown,
    unused: string,
    url?: string | URL | null
  ) {
    originalReplaceState.call(this, state, unused, url);
    checkUrlChange();
  };
}

// Also run when the page is fully loaded
window.addEventListener("load", () => {
  logger.info("Window load event fired");
  clearOfferCards();
  findAndProcessOfferCards().catch((error) => {
    logger.error("Error processing offer cards:", error);
  });
  logger.info("Setting up mutation observer...");
  setupMutationObserver();
  setupUrlChangeDetection();
});

// Set up mutation observer to watch for new cards
function setupMutationObserver() {
  logger.info("Starting mutation observer setup...");

  const observer = new MutationObserver((mutations) => {
    logger.debug(
      "Mutation observer callback triggered with",
      mutations.length,
      "mutations"
    );
    let hasNewCards = false;

    for (const mutation of mutations) {
      if (mutation.type === "childList") {
        logger.debug(
          "Processing childList mutation with",
          mutation.addedNodes.length,
          "added nodes"
        );
        // Check both added nodes and their children
        for (const node of Array.from(mutation.addedNodes)) {
          if (node instanceof Element) {
            // Check the node itself
            if (
              node.hasAttribute("data-component") &&
              (node.getAttribute("data-component") === "DiscoverOfferCard" ||
                node.getAttribute("data-component") === "BrowseOfferCard" ||
                node.getAttribute("data-component") === "VaultOfferCard")
            ) {
              logger.debug("Found new offer card in mutation:", node);
              hasNewCards = true;
              break;
            }

            // Check all children recursively
            const cards = node.querySelectorAll(
              '[data-component="DiscoverOfferCard"], [data-component="BrowseOfferCard"], [data-component="VaultOfferCard"]'
            );
            if (cards.length > 0) {
              logger.debug(
                `Found ${cards.length} new offer cards in mutation children`
              );
              hasNewCards = true;
              break;
            }
          }
        }
      }
    }

    if (hasNewCards) {
      logger.info("New offer cards detected, processing...");
      // Add a small delay to ensure all cards are properly loaded
      setTimeout(() => {
        findAndProcessOfferCards();
      }, 100);
    }
  });

  // Start observing the document body for changes
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true, // Watch for attribute changes
    characterData: true,
  });

  logger.info(
    "Mutation observer successfully set up and observing document.body"
  );
}
