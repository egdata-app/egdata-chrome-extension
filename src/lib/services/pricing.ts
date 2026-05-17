import type {
  OfferPriceHistoryResult,
  OfferSlugMapping,
  PagePrice,
  PriceHistoryPoint,
  PriceHistoryRequest,
  PriceHistoryTimeFrame,
} from '@/lib/messages';

const API_BASE_URL = 'https://api.egdata.app';
const DEFAULT_PRICE_HISTORY_TIME_FRAME: PriceHistoryTimeFrame = '2y';
const PRICE_HISTORY_TIME_FRAME_MONTHS: Record<
  Exclude<PriceHistoryTimeFrame, 'all'>,
  number
> = {
  '6m': 6,
  '1y': 12,
  '2y': 24,
};

interface ApiPrice {
  currencyCode: string;
  discountPrice: number;
  originalPrice?: number | null;
}

interface ApiPriceRecord {
  region?: string;
  namespace?: string;
  offerId?: string;
  updatedAt?: string;
  date?: string;
  price?: ApiPrice;
}

export interface RegionalPriceResult {
  currentPrice?: ApiPriceRecord;
  minPrice?: number | null;
  maxPrice?: number | null;
}

export interface SelectedRegionalPrice {
  region: string;
  data: RegionalPriceResult;
}

type RegionalPriceMap = Record<string, RegionalPriceResult>;

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

function parseApiPrice(value: unknown): ApiPrice | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const currencyCode = readString(value.currencyCode);
  const discountPrice = readNumber(value.discountPrice);
  if (!currencyCode || discountPrice === undefined) {
    return undefined;
  }

  return {
    currencyCode,
    discountPrice,
    originalPrice: readNumber(value.originalPrice) ?? null,
  };
}

function parseApiPriceRecord(value: unknown): ApiPriceRecord | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const price = parseApiPrice(value.price);
  if (!price) {
    return undefined;
  }

  return {
    region: readString(value.region),
    namespace: readString(value.namespace),
    offerId: readString(value.offerId),
    updatedAt: readString(value.updatedAt),
    date: readString(value.date),
    price,
  };
}

function parseRegionalPriceResult(value: unknown): RegionalPriceResult | null {
  if (!isRecord(value)) {
    return null;
  }

  return {
    currentPrice: parseApiPriceRecord(value.currentPrice),
    minPrice: readNumber(value.minPrice) ?? null,
    maxPrice: readNumber(value.maxPrice) ?? null,
  };
}

function parseRegionalPriceMap(value: unknown): RegionalPriceMap {
  if (!isRecord(value)) {
    return {};
  }

  return Object.entries(value).reduce<RegionalPriceMap>(
    (acc, [region, data]) => {
      const parsed = parseRegionalPriceResult(data);
      if (parsed?.currentPrice?.price) {
        acc[region] = parsed;
      }
      return acc;
    },
    {},
  );
}

function parseHistory(value: unknown): ApiPriceRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => parseApiPriceRecord(entry))
    .filter((entry): entry is ApiPriceRecord => Boolean(entry));
}

function normalizeCountry(country: string | undefined): string | undefined {
  const normalized = country?.trim().toUpperCase();
  return normalized && /^[A-Z]{2}$/.test(normalized) ? normalized : undefined;
}

function normalizePagePrice(price: PagePrice | undefined): PagePrice | null {
  const currencyCode = price?.currencyCode.trim().toUpperCase();
  const amount = price?.amount;
  if (!currencyCode || typeof amount !== 'number' || !Number.isFinite(amount)) {
    return null;
  }

  return {
    amount,
    currencyCode,
  };
}

function priceMatchesPagePrice(
  result: RegionalPriceResult,
  pagePrice: PagePrice,
): boolean {
  const price = result.currentPrice?.price;
  return (
    price?.currencyCode.toUpperCase() === pagePrice.currencyCode &&
    price.discountPrice === pagePrice.amount
  );
}

export function selectRegionalPrice(
  regionalPrices: RegionalPriceMap,
  pagePrice?: PagePrice,
  preferredRegion?: string | null,
): SelectedRegionalPrice | null {
  const normalizedPagePrice = normalizePagePrice(pagePrice);
  const normalizedPreferredRegion = preferredRegion?.trim();
  const regions = Object.keys(regionalPrices).sort();

  if (normalizedPagePrice) {
    const exactMatches = regions.filter((region) =>
      priceMatchesPagePrice(regionalPrices[region], normalizedPagePrice),
    );

    if (exactMatches.length > 0) {
      const preferredExactMatch = normalizedPreferredRegion
        ? exactMatches.find((region) => region === normalizedPreferredRegion)
        : undefined;
      const region = preferredExactMatch ?? exactMatches[0];
      return {
        region,
        data: regionalPrices[region],
      };
    }
  }

  if (
    normalizedPreferredRegion &&
    regionalPrices[normalizedPreferredRegion]?.currentPrice?.price
  ) {
    return {
      region: normalizedPreferredRegion,
      data: regionalPrices[normalizedPreferredRegion],
    };
  }

  if (regionalPrices.US?.currentPrice?.price) {
    return {
      region: 'US',
      data: regionalPrices.US,
    };
  }

  const firstRegion = regions.find(
    (region) => regionalPrices[region].currentPrice?.price,
  );
  return firstRegion
    ? {
        region: firstRegion,
        data: regionalPrices[firstRegion],
      }
    : null;
}

function toPriceHistoryPoint(record: ApiPriceRecord): PriceHistoryPoint | null {
  const date = record.date ?? record.updatedAt;
  if (!date || !record.price) {
    return null;
  }

  return {
    date,
    discountPrice: record.price.discountPrice,
    originalPrice: record.price.originalPrice ?? null,
    currencyCode: record.price.currencyCode,
  };
}

function normalizeHistoryPoints(
  history: ApiPriceRecord[],
  currentPrice: ApiPriceRecord,
): PriceHistoryPoint[] {
  const points = history
    .map((record) => toPriceHistoryPoint(record))
    .filter((point): point is PriceHistoryPoint => Boolean(point));
  const currentPoint = toPriceHistoryPoint(currentPrice);

  if (currentPoint) {
    points.push(currentPoint);
  }

  const pointMap = new Map<string, PriceHistoryPoint>();
  for (const point of points) {
    pointMap.set(`${point.date}:${point.discountPrice}`, point);
  }

  return Array.from(pointMap.values()).sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );
}

function getPointMinMax(points: PriceHistoryPoint[]): {
  minPrice: number | null;
  maxPrice: number | null;
} {
  const values = points.map((point) => point.discountPrice);
  if (values.length === 0) {
    return { minPrice: null, maxPrice: null };
  }

  return {
    minPrice: Math.min(...values),
    maxPrice: Math.max(...values),
  };
}

function normalizeTimeFrame(
  timeFrame: PriceHistoryRequest['timeFrame'],
): PriceHistoryTimeFrame {
  return timeFrame && timeFrame in PRICE_HISTORY_TIME_FRAME_MONTHS
    ? timeFrame
    : timeFrame === 'all'
      ? 'all'
      : DEFAULT_PRICE_HISTORY_TIME_FRAME;
}

export function getSinceDateForTimeFrame(
  timeFrame: PriceHistoryTimeFrame,
  now = new Date(),
): string | null {
  if (timeFrame === 'all') {
    return null;
  }

  const months = PRICE_HISTORY_TIME_FRAME_MONTHS[timeFrame];
  const since = new Date(now);
  since.setUTCMonth(since.getUTCMonth() - months);
  return since.toISOString();
}

async function fetchJson(url: string, options?: RequestInit): Promise<unknown> {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  return response.json() as Promise<unknown>;
}

async function fetchOfferMapping(slug: string): Promise<OfferSlugMapping> {
  const value = await fetchJson(`${API_BASE_URL}/offers/slugs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ slugs: [slug] }),
  });

  if (!Array.isArray(value)) {
    throw new Error('Failed to resolve offer slug');
  }

  const mapping = value.find(
    (entry): entry is OfferSlugMapping =>
      isRecord(entry) &&
      entry.slug === slug &&
      typeof entry.id === 'string' &&
      typeof entry.namespace === 'string',
  );

  if (!mapping?.id || !mapping.namespace) {
    throw new Error('Offer slug was not found');
  }

  return mapping;
}

async function resolveOfferReference(
  request: PriceHistoryRequest,
): Promise<{ offerId: string; namespace: string }> {
  const offerId = request.offerId?.trim();
  const namespace = request.namespace?.trim();
  if (offerId && namespace) {
    return { offerId, namespace };
  }

  const slug = request.slug.trim();
  if (!slug) {
    throw new Error('Missing offer slug');
  }

  const mapping = await fetchOfferMapping(slug);
  return {
    offerId: mapping.id as string,
    namespace: mapping.namespace as string,
  };
}

async function fetchAllRegionalPrices(
  offerId: string,
): Promise<RegionalPriceMap> {
  const value = await fetchJson(
    `${API_BASE_URL}/offers/${offerId}/regional-price`,
  );
  return parseRegionalPriceMap(value);
}

async function fetchRegionalPriceForCountry(
  offerId: string,
  country: string,
): Promise<SelectedRegionalPrice | null> {
  const params = new URLSearchParams({ country });
  const value = await fetchJson(
    `${API_BASE_URL}/offers/${offerId}/regional-price?${params.toString()}`,
  );
  const result = parseRegionalPriceResult(value);
  const region = result?.currentPrice?.region;

  return result?.currentPrice?.price && region
    ? {
        region,
        data: result,
      }
    : null;
}

async function fetchPriceHistory(
  offerId: string,
  region: string,
  timeFrame: PriceHistoryTimeFrame,
): Promise<ApiPriceRecord[]> {
  const params = new URLSearchParams({ region });
  const since = getSinceDateForTimeFrame(timeFrame);
  if (since) {
    params.set('since', since);
  }

  return parseHistory(
    await fetchJson(
      `${API_BASE_URL}/offers/${offerId}/price-history?${params.toString()}`,
    ),
  );
}

export class PricingService {
  async getOfferHistory(
    request: PriceHistoryRequest,
  ): Promise<OfferPriceHistoryResult> {
    const { offerId, namespace } = await resolveOfferReference(request);
    const timeFrame = normalizeTimeFrame(request.timeFrame);
    const countryCandidate = normalizeCountry(request.countryCandidate);
    const [regionalPrices, countryPrice] = await Promise.all([
      fetchAllRegionalPrices(offerId),
      countryCandidate
        ? fetchRegionalPriceForCountry(offerId, countryCandidate).catch(
            () => null,
          )
        : Promise.resolve(null),
    ]);

    const selected =
      selectRegionalPrice(
        regionalPrices,
        request.pagePrice,
        countryPrice?.region,
      ) ??
      countryPrice ??
      (countryCandidate
        ? await fetchRegionalPriceForCountry(offerId, 'US').catch(() => null)
        : null);

    if (!selected?.data.currentPrice?.price) {
      throw new Error('Price not found');
    }

    const history = await fetchPriceHistory(
      offerId,
      selected.region,
      timeFrame,
    );
    const points = normalizeHistoryPoints(history, selected.data.currentPrice);
    const pointMinMax = getPointMinMax(points);
    const price = selected.data.currentPrice.price;

    return {
      offerId,
      namespace,
      region: selected.region,
      currencyCode: price.currencyCode,
      timeFrame,
      currentPrice: {
        discountPrice: price.discountPrice,
        originalPrice: price.originalPrice ?? null,
        currencyCode: price.currencyCode,
      },
      minPrice: pointMinMax.minPrice,
      maxPrice: pointMinMax.maxPrice,
      points,
    };
  }
}

export const pricingService = new PricingService();
