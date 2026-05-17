import { EpicGamesGraphQLClient } from '@/lib/clients/epic';
import type {
  OfferLookupInput,
  OfferSlugMapping,
  OwnedOffersResult,
  OwnedSlugsResult,
} from '@/lib/messages';
import consola from 'consola';

const logger = consola.withTag('ownership-cache');

export const OWNERSHIP_CACHE_TTL_MS = 1000 * 60 * 60;

const SLUG_CACHE_KEY = 'egdata.ownership.slugCache';
const OFFER_CACHE_KEY = 'egdata.ownership.offerCache';

interface CachedSlugOwnership {
  slug: string;
  id: string | null;
  namespace: string | null;
  isOwned: boolean;
  lastCheckedAt: number;
}

interface CachedOfferOwnership extends OfferLookupInput {
  isOwned: boolean;
  lastCheckedAt: number;
}

type SlugCache = Record<string, CachedSlugOwnership>;
type OfferCache = Record<string, CachedOfferOwnership>;

interface FullyOwnedOffer {
  namespace: string;
  offerId: string;
}

export function normalizeSlugs(slugs: unknown): string[] {
  if (!Array.isArray(slugs)) {
    return [];
  }

  return Array.from(
    new Set(
      slugs
        .filter((slug): slug is string => typeof slug === 'string')
        .map((slug) => slug.trim())
        .filter(Boolean),
    ),
  );
}

export function normalizeOffers(offers: unknown): OfferLookupInput[] {
  if (!Array.isArray(offers)) {
    return [];
  }

  const normalized = offers
    .filter((offer): offer is Record<string, unknown> => {
      return typeof offer === 'object' && offer !== null;
    })
    .map((offer) => ({
      namespace:
        typeof offer.namespace === 'string' ? offer.namespace.trim() : '',
      offerId:
        typeof offer.offerId === 'string'
          ? offer.offerId.trim()
          : typeof offer.id === 'string'
            ? offer.id.trim()
            : '',
    }))
    .filter((offer) => offer.namespace && offer.offerId);

  const seen = new Set<string>();
  return normalized.filter((offer) => {
    const key = getOfferCacheKey(offer);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function getOfferCacheKey(offer: OfferLookupInput): string {
  return `${offer.namespace}:${offer.offerId}`;
}

export function mapOwnedSlugs(
  mappings: OfferSlugMapping[],
  fullyOwnedOffers: FullyOwnedOffer[],
): string[] {
  const ownedOfferKeys = new Set(
    fullyOwnedOffers.map((offer) =>
      getOfferCacheKey({
        namespace: offer.namespace,
        offerId: offer.offerId,
      }),
    ),
  );

  return mappings
    .filter((mapping) => mapping.namespace && mapping.id)
    .filter((mapping) =>
      ownedOfferKeys.has(
        getOfferCacheKey({
          namespace: mapping.namespace as string,
          offerId: mapping.id as string,
        }),
      ),
    )
    .map((mapping) => mapping.slug);
}

export function isFresh(lastCheckedAt: number, now = Date.now()): boolean {
  return now - lastCheckedAt < OWNERSHIP_CACHE_TTL_MS;
}

async function getStorageValue<T>(key: string, fallback: T): Promise<T> {
  const result = await chrome.storage.local.get(key);
  return (result[key] as T | undefined) ?? fallback;
}

async function setStorageValue<T>(key: string, value: T): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

export class OwnershipCacheService {
  private epicClient: EpicGamesGraphQLClient | null = null;
  private epicClientToken: string | null = null;

  resetEpicClient() {
    this.epicClient = null;
    this.epicClientToken = null;
  }

  async checkSlugs(slugsInput: unknown): Promise<OwnedSlugsResult> {
    const slugs = normalizeSlugs(slugsInput);
    if (slugs.length === 0) {
      return { ownedSlugs: [], offerMappings: [] };
    }

    const now = Date.now();
    const cache = await getStorageValue<SlugCache>(SLUG_CACHE_KEY, {});
    const cachedOwnedSlugs: string[] = [];
    const slugsToCheck: string[] = [];
    const cachedMappings: OfferSlugMapping[] = [];

    for (const slug of slugs) {
      const cached = cache[slug];
      if (cached && isFresh(cached.lastCheckedAt, now)) {
        cachedMappings.push({
          slug: cached.slug,
          id: cached.id,
          namespace: cached.namespace,
        });
        if (cached.isOwned) {
          cachedOwnedSlugs.push(slug);
        }
      } else {
        slugsToCheck.push(slug);
      }
    }

    if (slugsToCheck.length === 0) {
      return {
        ownedSlugs: cachedOwnedSlugs,
        offerMappings: cachedMappings,
      };
    }

    const offerMappings = await this.fetchOfferMappings(slugsToCheck);
    const offersToValidate = normalizeOffers(
      offerMappings
        .filter((mapping) => mapping.id && mapping.namespace)
        .map((mapping) => ({
          namespace: mapping.namespace as string,
          offerId: mapping.id as string,
        })),
    );

    const fullyOwnedOffers =
      offersToValidate.length > 0
        ? await this.getFullyOwnedOffers(offersToValidate)
        : [];
    const newlyOwnedSlugs = mapOwnedSlugs(offerMappings, fullyOwnedOffers);
    const newlyOwnedSet = new Set(newlyOwnedSlugs);

    const nextCache: SlugCache = { ...cache };
    for (const mapping of offerMappings) {
      nextCache[mapping.slug] = {
        slug: mapping.slug,
        id: mapping.id,
        namespace: mapping.namespace,
        isOwned: newlyOwnedSet.has(mapping.slug),
        lastCheckedAt: now,
      };
    }
    await setStorageValue(SLUG_CACHE_KEY, nextCache);

    return {
      ownedSlugs: Array.from(
        new Set([...cachedOwnedSlugs, ...newlyOwnedSlugs]),
      ),
      offerMappings: [...cachedMappings, ...offerMappings],
    };
  }

  async checkOffers(
    offersInput: unknown,
  ): Promise<OwnedOffersResult<OfferLookupInput>> {
    const offers = normalizeOffers(offersInput);
    if (offers.length === 0) {
      return { ownedOffers: [] };
    }

    const now = Date.now();
    const cache = await getStorageValue<OfferCache>(OFFER_CACHE_KEY, {});
    const cachedOwnedOffers: OfferLookupInput[] = [];
    const offersToCheck: OfferLookupInput[] = [];

    for (const offer of offers) {
      const cached = cache[getOfferCacheKey(offer)];
      if (cached && isFresh(cached.lastCheckedAt, now)) {
        if (cached.isOwned) {
          cachedOwnedOffers.push({
            namespace: cached.namespace,
            offerId: cached.offerId,
          });
        }
      } else {
        offersToCheck.push(offer);
      }
    }

    if (offersToCheck.length === 0) {
      return { ownedOffers: cachedOwnedOffers };
    }

    const fullyOwnedOffers = await this.getFullyOwnedOffers(offersToCheck);
    const ownedKeys = new Set(
      fullyOwnedOffers.map((offer) =>
        getOfferCacheKey({
          namespace: offer.namespace,
          offerId: offer.offerId,
        }),
      ),
    );
    const newlyOwnedOffers = offersToCheck.filter((offer) =>
      ownedKeys.has(getOfferCacheKey(offer)),
    );

    const nextCache: OfferCache = { ...cache };
    for (const offer of offersToCheck) {
      nextCache[getOfferCacheKey(offer)] = {
        ...offer,
        isOwned: ownedKeys.has(getOfferCacheKey(offer)),
        lastCheckedAt: now,
      };
    }
    await setStorageValue(OFFER_CACHE_KEY, nextCache);

    return {
      ownedOffers: [...cachedOwnedOffers, ...newlyOwnedOffers],
    };
  }

  private async fetchOfferMappings(
    slugs: string[],
  ): Promise<OfferSlugMapping[]> {
    const response = await fetch('https://api-gcp.egdata.app/offers/slugs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ slugs }),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch offer mappings: ${response.status}`);
    }

    return response.json() as Promise<OfferSlugMapping[]>;
  }

  private async getFullyOwnedOffers(
    offers: OfferLookupInput[],
  ): Promise<FullyOwnedOffer[]> {
    const token = await this.getEpicToken();
    const client = this.getEpicClient(token);
    const validationResult = await client.getOffersValidation({ offers });
    return (
      validationResult.Entitlements.cartOffersValidation.fullyOwnedOffers ?? []
    );
  }

  private getEpicClient(token: string): EpicGamesGraphQLClient {
    if (!this.epicClient || this.epicClientToken !== token) {
      logger.debug('Creating Epic ownership validation client');
      this.epicClient = new EpicGamesGraphQLClient({ token });
      this.epicClientToken = token;
    }

    return this.epicClient;
  }

  private async getEpicToken(): Promise<string> {
    const authCookie = await chrome.cookies.get({
      name: 'EPIC_EG1',
      url: 'https://store.epicgames.com',
    });

    if (!authCookie?.value) {
      throw new Error('Epic Games authentication cookie not found');
    }

    return authCookie.value;
  }
}

export const ownershipCacheService = new OwnershipCacheService();
