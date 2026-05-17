import {
  type RegionalPriceResult,
  getSinceDateForTimeFrame,
  selectRegionalPrice,
} from '@/lib/services/pricing';
import { describe, expect, it } from 'vitest';

function regionalPrice(
  currencyCode: string,
  discountPrice: number,
): RegionalPriceResult {
  return {
    currentPrice: {
      region: currencyCode === 'EUR' ? 'EURO' : 'US',
      price: {
        currencyCode,
        discountPrice,
        originalPrice: discountPrice,
      },
    },
    minPrice: discountPrice,
    maxPrice: discountPrice,
  };
}

describe('pricing region selection', () => {
  it('selects the exact page price match', () => {
    const selected = selectRegionalPrice(
      {
        EURO: regionalPrice('EUR', 1052),
        US: regionalPrice('USD', 999),
      },
      { amount: 1052, currencyCode: 'EUR' },
    );

    expect(selected?.region).toBe('EURO');
  });

  it('uses the preferred region as a tie-break for ambiguous currency matches', () => {
    const selected = selectRegionalPrice(
      {
        LATAM: regionalPrice('USD', 999),
        US: regionalPrice('USD', 999),
      },
      { amount: 999, currencyCode: 'USD' },
      'LATAM',
    );

    expect(selected?.region).toBe('LATAM');
  });

  it('falls back to the preferred region when no exact price matches', () => {
    const selected = selectRegionalPrice(
      {
        EURO: regionalPrice('EUR', 1052),
        US: regionalPrice('USD', 999),
      },
      { amount: 777, currencyCode: 'USD' },
      'EURO',
    );

    expect(selected?.region).toBe('EURO');
  });

  it('falls back to US when no preferred region is available', () => {
    const selected = selectRegionalPrice(
      {
        EURO: regionalPrice('EUR', 1052),
        US: regionalPrice('USD', 999),
      },
      { amount: 777, currencyCode: 'USD' },
    );

    expect(selected?.region).toBe('US');
  });
});

describe('pricing time frames', () => {
  it('maps finite time frames to since dates', () => {
    const now = new Date('2026-05-17T12:00:00.000Z');

    expect(getSinceDateForTimeFrame('6m', now)).toBe(
      '2025-11-17T12:00:00.000Z',
    );
    expect(getSinceDateForTimeFrame('1y', now)).toBe(
      '2025-05-17T12:00:00.000Z',
    );
    expect(getSinceDateForTimeFrame('2y', now)).toBe(
      '2024-05-17T12:00:00.000Z',
    );
  });

  it('maps all time to no since filter', () => {
    expect(getSinceDateForTimeFrame('all', new Date())).toBeNull();
  });
});
