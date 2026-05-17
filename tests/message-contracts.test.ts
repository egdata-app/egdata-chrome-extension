import { isExternalMessage, isInternalMessage } from '@/lib/messages';
import { describe, expect, it } from 'vitest';

describe('message contracts', () => {
  it('accepts known internal message actions', () => {
    expect(isInternalMessage({ action: 'auth.getStatus' })).toBe(true);
    expect(
      isInternalMessage({
        action: 'ownership.checkSlugs',
        payload: { slugs: ['alan-wake-2'] },
      }),
    ).toBe(true);
    expect(
      isInternalMessage({
        action: 'pricing.getOfferHistory',
        payload: { slug: 'alan-wake-2' },
      }),
    ).toBe(true);
  });

  it('rejects token access as an external message action', () => {
    expect(isExternalMessage({ action: 'getEpicToken' })).toBe(false);
  });

  it('rejects pricing as an external message action', () => {
    expect(
      isExternalMessage({
        action: 'pricing.getOfferHistory',
        payload: { slug: 'alan-wake-2' },
      }),
    ).toBe(false);
  });

  it('accepts ownership-only external message actions', () => {
    expect(
      isExternalMessage({
        action: 'ownership.checkOffers',
        payload: {
          offers: [{ namespace: 'example', offerId: 'offer-1' }],
        },
      }),
    ).toBe(true);
  });
});
