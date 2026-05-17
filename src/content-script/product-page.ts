import type { PagePrice, PriceHistoryRequest } from '@/lib/messages';

const PRODUCT_PATH_MARKER = 'p';
const FREE_PRICE_LABELS = new Set([
  'free',
  'gratis',
  'gratuit',
  'kostenlos',
  'gratis',
  'gratuito',
  'livre',
  'bezplatne',
  'za darmo',
]);

interface ProductStructuredData {
  slug: string;
  offerId?: string;
  namespace?: string;
  pagePrice?: PagePrice;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function getJsonLdType(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string');
  }

  return [];
}

function isJsonLdType(value: unknown, type: string): boolean {
  return getJsonLdType(value).includes(type);
}

function toPriceUnits(amount: number) {
  return Math.round(amount * 100);
}

function parseSku(sku: unknown): { namespace?: string; offerId?: string } {
  const rawSku = readString(sku);
  if (!rawSku) {
    return {};
  }

  const [namespace, offerId] = rawSku.split(':');
  return {
    namespace: namespace?.trim() || undefined,
    offerId: offerId?.trim() || undefined,
  };
}

function getPathSegments(href: string, origin = window.location.origin) {
  try {
    return new URL(href, origin).pathname.split('/').filter(Boolean);
  } catch {
    return [];
  }
}

export function extractProductSlug(href: string): string | null {
  const segments = getPathSegments(href);
  const productPathIndex = segments.indexOf(PRODUCT_PATH_MARKER);
  if (productPathIndex < 0) {
    return null;
  }

  const slug = segments[productPathIndex + 1]?.trim();
  return slug || null;
}

export function isEpicProductPageUrl(href: string): boolean {
  try {
    const url = new URL(href, window.location.origin);
    const isRelativeUrl = !/^[a-z][a-z\d+.-]*:/i.test(href);
    return (
      (isRelativeUrl || url.hostname === 'store.epicgames.com') &&
      Boolean(extractProductSlug(href))
    );
  } catch {
    return false;
  }
}

function pathnamesMatch(left: string, right: string): boolean {
  try {
    return (
      new URL(left, window.location.origin).pathname ===
      new URL(right, window.location.origin).pathname
    );
  } catch {
    return false;
  }
}

function readOfferPrice(offer: unknown): PagePrice | undefined {
  if (!isRecord(offer)) {
    return undefined;
  }

  const priceSpecification = isRecord(offer.priceSpecification)
    ? offer.priceSpecification
    : undefined;
  const currencyCode =
    readString(priceSpecification?.priceCurrency) ??
    readString(offer.priceCurrency);
  const price =
    readNumber(priceSpecification?.price) ?? readNumber(offer.price);

  return currencyCode && price !== undefined
    ? {
        amount: toPriceUnits(price),
        currencyCode,
      }
    : undefined;
}

function readProductPrice(
  product: Record<string, unknown>,
  currentHref: string,
): PagePrice | undefined {
  const offers = product.offers;
  if (!isRecord(offers)) {
    return undefined;
  }

  if (isJsonLdType(offers['@type'], 'Offer')) {
    return readOfferPrice(offers);
  }

  if (!isJsonLdType(offers['@type'], 'AggregateOffer')) {
    return undefined;
  }

  const matchingOffer = Array.isArray(offers.offers)
    ? offers.offers.find(
        (offer) =>
          isRecord(offer) &&
          readString(offer.url) &&
          pathnamesMatch(readString(offer.url) as string, currentHref),
      )
    : undefined;
  const matchingPrice = readOfferPrice(matchingOffer);
  if (matchingPrice) {
    return matchingPrice;
  }

  const currencyCode = readString(offers.priceCurrency);
  const lowPrice = readNumber(offers.lowPrice);
  return currencyCode && lowPrice !== undefined
    ? {
        amount: toPriceUnits(lowPrice),
        currencyCode,
      }
    : undefined;
}

function collectJsonLdProducts(root: ParentNode): Record<string, unknown>[] {
  return Array.from(root.querySelectorAll('script[type="application/ld+json"]'))
    .flatMap((script) => {
      const text = script.textContent?.trim();
      if (!text) {
        return [];
      }

      try {
        const parsed = JSON.parse(text) as unknown;
        if (Array.isArray(parsed)) {
          return parsed;
        }

        if (isRecord(parsed) && Array.isArray(parsed['@graph'])) {
          return parsed['@graph'];
        }

        return [parsed];
      } catch {
        return [];
      }
    })
    .filter(
      (entry): entry is Record<string, unknown> =>
        isRecord(entry) && isJsonLdType(entry['@type'], 'Product'),
    );
}

export function parseProductStructuredData(
  root: ParentNode = document,
  href = window.location.href,
): ProductStructuredData | null {
  const slug = extractProductSlug(href);
  if (!slug) {
    return null;
  }

  const product = collectJsonLdProducts(root).find((entry) => {
    const productUrl = readString(entry.url) ?? readString(entry['@id']);
    return productUrl ? pathnamesMatch(productUrl, href) : true;
  });

  if (!product) {
    return { slug };
  }

  return {
    slug,
    ...parseSku(product.sku),
    pagePrice: readProductPrice(product, href),
  };
}

export function deriveCountryCandidateFromLocale(
  href = window.location.href,
  locale?: string,
): string | undefined {
  const localeSegment = getPathSegments(href).find((segment) =>
    /^[a-z]{2}-[A-Z]{2}$/.test(segment),
  );
  const source = localeSegment ?? locale;
  const country = source?.split('-')[1]?.toUpperCase();
  return country && /^[A-Z]{2}$/.test(country) ? country : undefined;
}

export function normalizePriceText(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/\u00a0|\u202f/g, ' ')
    .replace(/\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatPriceText(price: PagePrice, locale: string | undefined): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: price.currencyCode,
    }).format(price.amount / 100);
  } catch {
    return `${price.amount / 100} ${price.currencyCode}`;
  }
}

function getPriceTextCandidates(
  price: PagePrice,
  locale: string | undefined,
): string[] {
  const candidates = [normalizePriceText(formatPriceText(price, locale))];
  if (price.amount === 0) {
    candidates.push(...FREE_PRICE_LABELS);
  }

  return Array.from(
    new Set(candidates.map((candidate) => candidate.toLowerCase())),
  );
}

export function findPrimaryPriceElement(
  root: ParentNode,
  price: PagePrice | undefined,
  locale?: string,
): HTMLElement | null {
  if (!price) {
    return null;
  }

  const candidates = getPriceTextCandidates(price, locale);
  const compactCandidates = candidates.map((candidate) =>
    candidate.replace(/\s/g, ''),
  );

  return (
    Array.from(root.querySelectorAll('strong')).find((element) => {
      const normalizedText = normalizePriceText(element.textContent ?? '')
        .toLowerCase()
        .replace(/\s/g, '');
      return compactCandidates.includes(normalizedText);
    }) ?? null
  );
}

export function buildPriceHistoryRequest(
  root: ParentNode = document,
  href = window.location.href,
): PriceHistoryRequest | null {
  if (!isEpicProductPageUrl(href)) {
    return null;
  }

  const locale = document.documentElement.lang || undefined;
  const structuredData = parseProductStructuredData(root, href);
  if (!structuredData) {
    return null;
  }

  return {
    slug: structuredData.slug,
    offerId: structuredData.offerId,
    namespace: structuredData.namespace,
    pagePrice: structuredData.pagePrice,
    locale,
    countryCandidate: deriveCountryCandidateFromLocale(href, locale),
  };
}
