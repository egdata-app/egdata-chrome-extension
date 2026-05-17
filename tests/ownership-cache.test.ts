import {
  getOfferCacheKey,
  isFresh,
  mapOwnedSlugs,
  normalizeOffers,
  normalizeSlugs,
} from '@/lib/services/ownership-cache';
import { describe, expect, it } from 'vitest';

describe('ownership cache helpers', () => {
  it('normalizes slugs by trimming and deduping', () => {
    expect(normalizeSlugs([' game-one ', '', 'game-one', 'game-two'])).toEqual([
      'game-one',
      'game-two',
    ]);
  });

  it('normalizes both current and legacy offer shapes', () => {
    expect(
      normalizeOffers([
        { namespace: 'ns', offerId: 'offer-1' },
        { namespace: 'ns', id: 'offer-2' },
        { namespace: 'ns', id: 'offer-2' },
        { namespace: '', id: 'ignored' },
      ]),
    ).toEqual([
      { namespace: 'ns', offerId: 'offer-1' },
      { namespace: 'ns', offerId: 'offer-2' },
    ]);
  });

  it('maps owned Epic offers back to slugs', () => {
    expect(
      mapOwnedSlugs(
        [
          { slug: 'owned-game', namespace: 'ns', id: 'owned' },
          { slug: 'missing-game', namespace: 'ns', id: 'missing' },
          { slug: 'unmapped-game', namespace: null, id: null },
        ],
        [{ namespace: 'ns', offerId: 'owned' }],
      ),
    ).toEqual(['owned-game']);
  });

  it('detects fresh and stale cache entries', () => {
    expect(isFresh(1_000, 1_000 + 60_000)).toBe(true);
    expect(isFresh(1_000, 1_000 + 3_600_000)).toBe(false);
  });

  it('uses a stable offer cache key', () => {
    expect(getOfferCacheKey({ namespace: 'ns', offerId: 'offer' })).toBe(
      'ns:offer',
    );
  });
});
