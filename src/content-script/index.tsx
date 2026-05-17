import consola from "consola";
import { createRoot } from "react-dom/client";
import { openDB, type IDBPDatabase } from "idb";
import { OwnedIndicator } from "./OwnedIndicator";
import "./styles.css";
import { EpicGamesGraphQLClient } from "@/lib/clients/epic";
import type {
  AppSettings,
  OwnershipStatus,
  OwnershipStatusResult,
} from "@/types/egdata";

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
  status: OwnershipStatus;
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
    status: existingData?.status ?? "unknown",
    lastChecked: Date.now(),
    ...data,
  };
  await saveOfferDataToDB({ [slug]: updatedData });
}

async function getSettings(): Promise<AppSettings> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: "getSettings" }, (response) => {
      resolve(
        response?.settings ?? {
          country: "US",
          overlayEnabled: true,
          notificationsEnabled: false,
          freeGameRemindersEnabled: false,
          dealAlertsEnabled: false,
        }
      );
    });
  });
}

// Function to add owned indicator to a card
function addOwnedIndicator(
  card: Element,
  slug: string,
  status: OwnershipStatus = "owned"
) {
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

  createRoot(indicator).render(<OwnedIndicator status={status} />);
}

// Function to process owned slugs and update UI
async function processOwnedSlugs(
  ownedSlugs: string[],
  currentCards: OfferCard[] = [],
  checkedSlugs: string[] = [],
  ownershipBySlug: Record<string, OwnershipStatus> = {}
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
      const status = ownershipBySlug[card.slug] ?? (isOwned ? "owned" : "not-owned");
      logger.debug(
        "Updating cache for checked slug:",
        card.slug,
        "isOwned:",
        isOwned
      );
      await updateCachedOfferData(card.slug, { isOwned, status });
    }

    // Always add indicator if owned, regardless of whether we checked it
    const status = ownershipBySlug[card.slug] ?? (ownedSlugsSet.has(card.slug) ? "owned" : "not-owned");
    if (status !== "not-owned" && status !== "unknown") {
      logger.info("Adding ownership indicator to card:", card.slug, status);
      addOwnedIndicator(card.element, card.slug, status);
    }
  }
}

async function checkOwnershipDirectly(slugs: string[]): Promise<{
  ownedSlugs: string[];
  ownershipBySlug: Record<string, OwnershipStatus>;
  offerMappings: Array<{
    slug: string;
    id: string | null;
    namespace: string | null;
  }>;
}> {
  const tokenResponse = await new Promise<
    { token: string } | { error: string }
  >((resolve) => {
    chrome.runtime.sendMessage({ action: "getEpicToken" }, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ error: chrome.runtime.lastError.message as string });
      } else {
        resolve(response as { token: string });
      }
    });
  });

  if ("error" in tokenResponse) {
    throw new Error(tokenResponse.error);
  }

  const token = tokenResponse.token;
  if (!token) {
    throw new Error("No token received from background script");
  }

  const egdataResponse = await fetch(
    "https://api-gcp.egdata.app/offers/slugs",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ slugs }),
    }
  );

  if (!egdataResponse.ok) {
    const errorText = await egdataResponse.text();
    throw new Error(
      `Failed to fetch offer IDs from egdata.app: ${egdataResponse.status} ${errorText}`
    );
  }

  const offerMappingsFromEgdata: Array<{
    slug: string;
    id: string | null;
    namespace: string | null;
  }> = await egdataResponse.json();

  const epicClient = new EpicGamesGraphQLClient({
    token,
  });

  const epicOffersPayload = offerMappingsFromEgdata
    .filter((o) => o.id && o.namespace)
    .map((o) => ({
      namespace: o.namespace,
      offerId: o.id,
    })) as { namespace: string; offerId: string }[];

  const validationResult = await epicClient.getOffersValidation({
    offers: epicOffersPayload,
  });

  const ownershipStatuses = buildOwnershipStatuses(
    epicOffersPayload,
    validationResult.Entitlements.cartOffersValidation
  );
  const statusByOffer = new Map(
    ownershipStatuses.map((result) => [
      `${result.namespace}-${result.offerId}`,
      result.status,
    ])
  );
  const ownedEpicOffersSet = new Set(
    ownershipStatuses
      .filter((result) => result.status === "owned")
      .map((result) => `${result.namespace}-${result.offerId}`)
  );

  const ownedSlugsResult = offerMappingsFromEgdata
    .filter((o) => o.id && o.namespace)
    .filter((o) => ownedEpicOffersSet.has(`${o.namespace}-${o.id}`))
    .map((o) => o.slug);

  return {
    ownedSlugs: ownedSlugsResult,
    offerMappings: offerMappingsFromEgdata,
    ownershipBySlug: Object.fromEntries(
      offerMappingsFromEgdata
        .filter((o) => o.id && o.namespace)
        .map((o) => [
          o.slug,
          statusByOffer.get(`${o.namespace}-${o.id}`) ?? "not-owned",
        ])
    ),
  };
}

function buildOwnershipStatuses(
  offers: Array<{ namespace: string; offerId: string }>,
  validationResult: {
    conflictingOffers?: Array<{ namespace: string; offerId: string }>;
    missingPrerequisites?: Array<{ namespace: string; offerId: string }>;
    fullyOwnedOffers?: Array<{ namespace: string; offerId: string }>;
    possiblePartialUpgradeOffers?: Array<{ namespace: string; offerId: string }>;
    unablePartiallyUpgradeOffers?: Array<{ namespace: string; offerId: string }>;
  }
): OwnershipStatusResult[] {
  const statusByKey = new Map<string, OwnershipStatus>();
  const setStatus = (
    values: Array<{ namespace: string; offerId: string }> | undefined,
    status: OwnershipStatus
  ) => {
    for (const value of values ?? []) {
      statusByKey.set(`${value.namespace}-${value.offerId}`, status);
    }
  };

  setStatus(validationResult.fullyOwnedOffers, "owned");
  setStatus(validationResult.conflictingOffers, "duplicate");
  setStatus(validationResult.possiblePartialUpgradeOffers, "partial-upgrade");
  setStatus(validationResult.unablePartiallyUpgradeOffers, "partial-upgrade");
  setStatus(validationResult.missingPrerequisites, "missing-prerequisite");

  return offers.map((offer) => ({
    namespace: offer.namespace,
    offerId: offer.offerId,
    status:
      statusByKey.get(`${offer.namespace}-${offer.offerId}`) ?? "not-owned",
  }));
}

async function findAndProcessOfferCards(): Promise<void> {
  logger.info("Searching for offer cards on:", window.location.href);
  const settings = await getSettings();
  if (!settings.overlayEnabled) {
    clearOfferCards();
    removeAssistantPanel();
    logger.info("Store overlay disabled in settings");
    return;
  }

  await processPageAssistant(settings);

  const currentOfferCardsThisRun: OfferCard[] = [];
  const slugsToCheck: string[] = [];
  const ownedSlugs: string[] = [];
  const cachedOwnershipBySlug: Record<string, OwnershipStatus> = {};

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

          if (
            cachedData?.status &&
            cachedData.status !== "not-owned" &&
            cachedData.status !== "unknown"
          ) {
            logger.debug(
              "Found cached owned status for:",
              slug,
              "with data:",
              cachedData
            );
            cachedOwnershipBySlug[slug] = cachedData.status;
            ownedSlugs.push(slug);
          } else if (cachedData?.isOwned) {
            cachedOwnershipBySlug[slug] = "owned";
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
      await processOwnedSlugs(
        ownedSlugs,
        currentOfferCardsThisRun,
        ownedSlugs,
        cachedOwnershipBySlug
      );
    } else {
      logger.debug("No cached owned slugs found.");
    }

    if (slugsToCheck.length > 0) {
      logger.debug("Checking ownership for slugs:", slugsToCheck);
      try {
        const {
          ownedSlugs: responseOwnedSlugs,
          offerMappings,
          ownershipBySlug,
        } = await checkOwnershipDirectly(slugsToCheck);

        logger.info("Owned slugs determined:", responseOwnedSlugs);

        // Store offer mappings in cache
        if (offerMappings) {
          for (const mapping of offerMappings) {
            await updateCachedOfferData(mapping.slug, {
              id: mapping.id,
              namespace: mapping.namespace,
              offerId: mapping.id, // The offerId is the same as the id in this case
              status: ownershipBySlug[mapping.slug] ?? "not-owned",
            });
          }
        }

        await processOwnedSlugs(
          responseOwnedSlugs,
          currentOfferCardsThisRun,
          slugsToCheck,
          ownershipBySlug
        );
      } catch (error) {
        logger.error("Error checking ownership:", error);
      }
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

const ASSISTANT_PANEL_ID = "egdata-assistant-panel";

function removeAssistantPanel() {
  document.getElementById(ASSISTANT_PANEL_ID)?.remove();
}

function statusLabel(status: OwnershipStatus) {
  switch (status) {
    case "owned":
      return "Owned";
    case "duplicate":
      return "Duplicate";
    case "partial-upgrade":
      return "Upgrade/partial ownership";
    case "missing-prerequisite":
      return "Missing prerequisite";
    case "not-owned":
      return "Not owned";
    default:
      return "Unknown";
  }
}

function createAssistantPanel({
  title,
  detail,
  status,
  actions = [],
}: {
  title: string;
  detail: string;
  status?: OwnershipStatus;
  actions?: Array<{ label: string; onClick: () => void }>;
}) {
  removeAssistantPanel();
  const panel = document.createElement("div");
  panel.id = ASSISTANT_PANEL_ID;
  panel.style.cssText = [
    "position:fixed",
    "right:18px",
    "bottom:18px",
    "z-index:2147483647",
    "width:320px",
    "max-width:calc(100vw - 36px)",
    "border:1px solid rgba(255,255,255,.14)",
    "border-radius:10px",
    "background:#111827",
    "color:#f9fafb",
    "box-shadow:0 20px 40px rgba(0,0,0,.35)",
    "font-family:Inter,system-ui,sans-serif",
    "padding:14px",
  ].join(";");

  const badge = status
    ? `<span style="display:inline-flex;border-radius:999px;background:rgba(59,130,246,.2);padding:2px 8px;font-size:12px;color:#bfdbfe">${statusLabel(
        status
      )}</span>`
    : "";
  panel.innerHTML = `
    <div style="display:flex;align-items:start;justify-content:space-between;gap:10px">
      <div>
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
          <strong style="font-size:14px">EGDATA</strong>${badge}
        </div>
        <div style="font-size:14px;font-weight:600;line-height:1.35">${title}</div>
        <div style="font-size:12px;color:#9ca3af;margin-top:4px;line-height:1.45">${detail}</div>
      </div>
      <button type="button" aria-label="Close" style="background:transparent;border:0;color:#9ca3af;cursor:pointer;font-size:18px;line-height:1">x</button>
    </div>
    <div data-actions style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px"></div>
  `;
  panel.querySelector("button")?.addEventListener("click", removeAssistantPanel);
  const actionsNode = panel.querySelector("[data-actions]");
  for (const action of actions) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = action.label;
    button.style.cssText =
      "border:1px solid rgba(255,255,255,.16);border-radius:7px;background:#1f2937;color:#f9fafb;padding:6px 9px;font-size:12px;cursor:pointer";
    button.addEventListener("click", action.onClick);
    actionsNode?.appendChild(button);
  }
  document.body.appendChild(panel);
}

async function processPageAssistant(settings: AppSettings) {
  const url = new URL(window.location.href);
  if (url.pathname.includes("/purchase")) {
    await processPurchasePage(url);
    return;
  }

  const productSlug = url.pathname.split("/p/")[1]?.split(/[/?#]/)[0];
  if (productSlug) {
    await processProductPage(productSlug, settings);
  } else {
    removeAssistantPanel();
  }
}

async function processProductPage(slug: string, settings: AppSettings) {
  try {
    const { offerMappings, ownershipBySlug } = await checkOwnershipDirectly([slug]);
    const mapping = offerMappings.find((offer) => offer.slug === slug);
    const status = ownershipBySlug[slug] ?? "not-owned";
    if (!mapping?.id || !mapping.namespace) {
      return;
    }

    createAssistantPanel({
      title: document.title.replace(" | Download and Buy Today", ""),
      detail:
        status === "not-owned"
          ? "This offer is not in your Epic library."
          : "Ownership validation found a relevant library or purchase status.",
      status,
      actions: [
        {
          label: "Open egdata",
          onClick: () => window.open(`https://egdata.app/offers/${mapping.id}`, "_blank"),
        },
        {
          label: "Watch",
          onClick: () => {
            chrome.runtime.sendMessage({
              action: "updateWatchlist",
              payload: {
                type: "upsert",
                item: {
                  offerId: mapping.id,
                  namespace: mapping.namespace,
                  title: document.title.split("|")[0].trim() || slug,
                  country: settings.country,
                  targetPrice: null,
                  currentPrice: null,
                  lastSeenPrice: null,
                  lastNotifiedPrice: null,
                  imageUrl: null,
                  storeUrl: window.location.href,
                  egdataUrl: `https://egdata.app/offers/${mapping.id}`,
                },
              },
            });
          },
        },
      ],
    });
  } catch (error) {
    logger.error("Failed to process product page assistant:", error);
  }
}

async function processPurchasePage(url: URL) {
  const offers = url.searchParams
    .getAll("offers")
    .map((offer) => {
      const [, namespace, offerId] = offer.split("-");
      return namespace && offerId ? { namespace, offerId } : null;
    })
    .filter(Boolean) as Array<{ namespace: string; offerId: string }>;

  if (offers.length === 0) {
    return;
  }

  const response = await new Promise<{
    ownershipStatuses?: OwnershipStatusResult[];
    error?: string;
  }>((resolve) => {
    chrome.runtime.sendMessage(
      { action: "getOwnedOffers", payload: { offers } },
      (message) => resolve(message)
    );
  });

  if (response.error) {
    logger.warn("Purchase page ownership check failed:", response.error);
    return;
  }

  const risky = (response.ownershipStatuses ?? []).filter(
    (result) => result.status !== "not-owned" && result.status !== "unknown"
  );
  if (risky.length === 0) {
    removeAssistantPanel();
    return;
  }

  createAssistantPanel({
    title: `${risky.length} purchase item${risky.length === 1 ? "" : "s"} need attention`,
    detail:
      "Some offers appear owned, duplicate, partial, or blocked by prerequisites.",
    status: risky[0].status,
    actions: [
      {
        label: "Remove from cart URL",
        onClick: () => {
          const filtered = offers.filter(
            (offer) =>
              !risky.some(
                (item) =>
                  item.namespace === offer.namespace &&
                  item.offerId === offer.offerId
              )
          );
          const nextUrl = new URL("https://store.epicgames.com/purchase");
          for (const offer of filtered) {
            nextUrl.searchParams.append(
              "offers",
              `1-${offer.namespace}-${offer.offerId}`
            );
          }
          window.location.href = nextUrl.toString();
        },
      },
    ],
  });
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
