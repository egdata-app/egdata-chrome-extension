import { messagingClient } from '@/lib/clients/messaging';
import consola from 'consola';
import { type Root, createRoot } from 'react-dom/client';
import { OwnedIndicator } from './OwnedIndicator';
import { PriceHistoryHovercard } from './PriceHistoryHovercard';
import {
  buildPriceHistoryRequest,
  findPrimaryPriceElement,
  isEpicProductPageUrl,
} from './product-page';
import './styles.css';

const logger = consola.withTag('content-script');
const OFFER_CARD_SELECTOR =
  '[data-component="DiscoverOfferCard"], [data-component="BrowseOfferCard"], [data-component="VaultOfferCard"], a[href*="/p/"]';
const INDICATOR_CLASS = 'egdata-owned-indicator';
const PRICE_HISTORY_CLASS = 'egdata-price-history-root';
const SCAN_DEBOUNCE_MS = 250;

export interface OfferCard {
  element: Element;
  slug: string;
}

let scanTimer: number | undefined;
let productPageScanTimer: number | undefined;
let observer: MutationObserver | null = null;
let lastUrl = window.location.href;
let initialized = false;
const priceHistoryRoots = new Map<HTMLElement, Root>();

export function extractStoreSlug(href: string): string | null {
  try {
    const url = new URL(href, window.location.origin);
    const slug = url.pathname.split('/p/')[1]?.split('/')[0]?.trim();
    return slug || null;
  } catch {
    return null;
  }
}

function getCardElement(candidate: Element): Element | null {
  if (candidate instanceof HTMLAnchorElement) {
    return (
      candidate.closest(
        '[data-component="DiscoverOfferCard"], [data-component="BrowseOfferCard"], [data-component="VaultOfferCard"]',
      ) ??
      candidate.closest('div[class*="css-"]') ??
      candidate
    );
  }

  return candidate;
}

export function findOfferCards(root: ParentNode = document): OfferCard[] {
  const cards: OfferCard[] = [];

  for (const candidate of Array.from(
    root.querySelectorAll(OFFER_CARD_SELECTOR),
  )) {
    const link =
      candidate instanceof HTMLAnchorElement
        ? candidate
        : candidate.querySelector('a[href*="/p/"]');

    if (!link || !link.querySelector('img')) {
      continue;
    }

    const href = link.getAttribute('href');
    if (!href) {
      continue;
    }

    const slug = extractStoreSlug(href);
    const cardElement = getCardElement(candidate);
    if (!slug || !cardElement) {
      continue;
    }

    if (
      cards.some((card) => card.element === cardElement && card.slug === slug)
    ) {
      continue;
    }

    cards.push({ element: cardElement, slug });
  }

  return cards;
}

function removeOwnedIndicator(card: Element) {
  card.querySelector(`.${INDICATOR_CLASS}`)?.remove();
  (card as HTMLElement).removeAttribute('data-egdata-owned-slug');
}

function removePriceHistoryHovercards() {
  for (const container of Array.from(
    document.querySelectorAll<HTMLElement>(`.${PRICE_HISTORY_CLASS}`),
  )) {
    priceHistoryRoots.get(container)?.unmount();
    priceHistoryRoots.delete(container);
    container.remove();
  }

  for (const target of Array.from(
    document.querySelectorAll('[data-egdata-price-history-slug]'),
  )) {
    target.removeAttribute('data-egdata-price-history-slug');
  }
}

function addOwnedIndicator(card: Element, slug: string) {
  const existingIndicator = card.querySelector(`.${INDICATOR_CLASS}`);
  const currentSlug = (card as HTMLElement).dataset.egdataOwnedSlug;

  if (existingIndicator && currentSlug === slug) {
    return;
  }

  existingIndicator?.remove();
  (card as HTMLElement).dataset.egdataOwnedSlug = slug;

  const position = window.getComputedStyle(card).position;
  if (position === 'static') {
    (card as HTMLElement).style.position = 'relative';
  }

  const indicator = document.createElement('div');
  indicator.className = INDICATOR_CLASS;
  indicator.style.position = 'absolute';
  indicator.style.left = '8px';
  indicator.style.top = '8px';
  indicator.style.zIndex = '10';
  indicator.style.pointerEvents = 'none';
  card.appendChild(indicator);

  createRoot(indicator).render(<OwnedIndicator />);
}

function addPriceHistoryHovercard(
  target: HTMLElement,
  request: NonNullable<ReturnType<typeof buildPriceHistoryRequest>>,
) {
  const currentSlug = target.dataset.egdataPriceHistorySlug;
  const existingContainer =
    target.nextElementSibling instanceof HTMLElement &&
    target.nextElementSibling.classList.contains(PRICE_HISTORY_CLASS)
      ? target.nextElementSibling
      : null;

  if (existingContainer && currentSlug === request.slug) {
    return;
  }

  if (existingContainer) {
    priceHistoryRoots.get(existingContainer)?.unmount();
    priceHistoryRoots.delete(existingContainer);
    existingContainer.remove();
  }

  target.dataset.egdataPriceHistorySlug = request.slug;

  const container = document.createElement('span');
  container.className = PRICE_HISTORY_CLASS;
  container.dataset.egdataPriceHistorySlug = request.slug;
  target.insertAdjacentElement('afterend', container);

  const root = createRoot(container);
  priceHistoryRoots.set(container, root);
  root.render(<PriceHistoryHovercard request={request} />);
}

async function scanOfferCards() {
  const settings = await messagingClient.getSettings();
  const cards = findOfferCards();

  if (!settings.showOwnedBadges) {
    for (const card of cards) {
      removeOwnedIndicator(card.element);
    }
    return;
  }

  const slugs = Array.from(new Set(cards.map((card) => card.slug)));
  if (slugs.length === 0) {
    return;
  }

  const { ownedSlugs } = await messagingClient.checkOwnedSlugs(slugs);
  const ownedSlugSet = new Set(ownedSlugs);

  for (const card of cards) {
    if (ownedSlugSet.has(card.slug)) {
      addOwnedIndicator(card.element, card.slug);
    } else {
      removeOwnedIndicator(card.element);
    }
  }
}

function scanProductPagePriceHistory() {
  if (!isEpicProductPageUrl(window.location.href)) {
    removePriceHistoryHovercards();
    return;
  }

  const request = buildPriceHistoryRequest();
  if (!request?.pagePrice) {
    return;
  }

  const target = findPrimaryPriceElement(
    document,
    request.pagePrice,
    request.locale,
  );
  if (!target) {
    return;
  }

  addPriceHistoryHovercard(target, request);
}

function scheduleScan(delay = SCAN_DEBOUNCE_MS) {
  if (scanTimer) {
    window.clearTimeout(scanTimer);
  }

  scanTimer = window.setTimeout(() => {
    scanOfferCards().catch((error) => {
      logger.error('Error scanning offer cards:', error);
    });
  }, delay);
}

function scheduleProductPageScan(delay = SCAN_DEBOUNCE_MS) {
  if (productPageScanTimer) {
    window.clearTimeout(productPageScanTimer);
  }

  productPageScanTimer = window.setTimeout(() => {
    try {
      scanProductPagePriceHistory();
    } catch (error) {
      logger.error('Error scanning product page price:', error);
    }
  }, delay);
}

function handleUrlChange() {
  const currentUrl = window.location.href;
  if (currentUrl === lastUrl) {
    return;
  }

  lastUrl = currentUrl;
  for (const indicator of Array.from(
    document.querySelectorAll(`.${INDICATOR_CLASS}`),
  )) {
    indicator.remove();
  }
  removePriceHistoryHovercards();
  scheduleScan(500);
  scheduleProductPageScan(500);
}

function installUrlHooks() {
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  history.pushState = function pushState(
    state: unknown,
    unused: string,
    url?: string | URL | null,
  ) {
    originalPushState.call(this, state, unused, url);
    handleUrlChange();
  };

  history.replaceState = function replaceState(
    state: unknown,
    unused: string,
    url?: string | URL | null,
  ) {
    originalReplaceState.call(this, state, unused, url);
    handleUrlChange();
  };

  window.addEventListener('popstate', handleUrlChange);
  window.setInterval(handleUrlChange, 1000);
}

function installMutationObserver() {
  observer?.disconnect();
  observer = new MutationObserver((mutations) => {
    const hasAddedElements = mutations.some((mutation) =>
      Array.from(mutation.addedNodes).some((node) => node instanceof Element),
    );

    if (hasAddedElements) {
      scheduleScan();
      scheduleProductPageScan();
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

function initialize() {
  if (initialized || typeof chrome === 'undefined') {
    return;
  }

  initialized = true;
  installUrlHooks();
  installMutationObserver();
  scheduleScan(100);
  scheduleProductPageScan(250);
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', initialize, { once: true });
} else {
  initialize();
}
