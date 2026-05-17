import { extractStoreSlug, findOfferCards } from '@/content-script';
import {
  deriveCountryCandidateFromLocale,
  extractProductSlug,
  findPrimaryPriceElement,
  isEpicProductPageUrl,
  normalizePriceText,
  parseProductStructuredData,
} from '@/content-script/product-page';
import { describe, expect, it } from 'vitest';

describe('content script offer card detection', () => {
  it('extracts Epic Store product slugs from relative and absolute URLs', () => {
    expect(extractStoreSlug('/en-US/p/game-one')).toBe('game-one');
    expect(
      extractStoreSlug('https://store.epicgames.com/en-US/p/game-two'),
    ).toBe('game-two');
  });

  it('finds offer cards with image links and ignores links without images', () => {
    document.body.innerHTML = `
      <section>
        <div data-component="DiscoverOfferCard">
          <a href="/en-US/p/game-one"><img src="cover.jpg" /></a>
        </div>
        <a href="/en-US/p/game-two"><img src="cover-2.jpg" /></a>
        <a href="/en-US/p/no-image">No image</a>
      </section>
    `;

    expect(findOfferCards()).toEqual([
      {
        element: document.querySelector('[data-component="DiscoverOfferCard"]'),
        slug: 'game-one',
      },
      {
        element: document.querySelector('a[href="/en-US/p/game-two"]'),
        slug: 'game-two',
      },
    ]);
  });

  it('dedupes the same card and slug pair', () => {
    document.body.innerHTML = `
      <div data-component="BrowseOfferCard">
        <a href="/en-US/p/game-one"><img src="cover.jpg" /></a>
      </div>
    `;

    expect(findOfferCards()).toHaveLength(1);
  });
});

describe('content script product page helpers', () => {
  it('detects current and locale-prefixed Epic product URLs', () => {
    expect(isEpicProductPageUrl('https://store.epicgames.com/p/game-one')).toBe(
      true,
    );
    expect(
      isEpicProductPageUrl('https://store.epicgames.com/en-US/p/game-two'),
    ).toBe(true);
    expect(extractProductSlug('/en-US/p/game-three')).toBe('game-three');
    expect(isEpicProductPageUrl('https://store.epicgames.com/browse')).toBe(
      false,
    );
  });

  it('parses product JSON-LD sku and offer price', () => {
    document.body.innerHTML = `
      <script type="application/ld+json">
        {
          "@type": "Product",
          "url": "https://store.epicgames.com/p/game-one",
          "sku": "namespace-1:offer-1",
          "offers": {
            "@type": "Offer",
            "priceSpecification": {
              "price": 10.52,
              "priceCurrency": "EUR"
            }
          }
        }
      </script>
    `;

    expect(
      parseProductStructuredData(
        document,
        'https://store.epicgames.com/p/game-one',
      ),
    ).toEqual({
      slug: 'game-one',
      namespace: 'namespace-1',
      offerId: 'offer-1',
      pagePrice: {
        amount: 1052,
        currencyCode: 'EUR',
      },
    });
  });

  it('uses only the aggregate offer that matches the current product URL', () => {
    document.body.innerHTML = `
      <script type="application/ld+json">
        {
          "@type": "Product",
          "url": "https://store.epicgames.com/p/base-game",
          "sku": "namespace-1:base-offer",
          "offers": {
            "@type": "AggregateOffer",
            "priceCurrency": "EUR",
            "lowPrice": 5,
            "offers": [
              {
                "@type": "Offer",
                "url": "/p/cheaper-addon",
                "priceSpecification": {
                  "price": 5,
                  "priceCurrency": "EUR"
                }
              },
              {
                "@type": "Offer",
                "url": "/p/base-game",
                "priceSpecification": {
                  "price": 12.99,
                  "priceCurrency": "EUR"
                }
              }
            ]
          }
        }
      </script>
    `;

    expect(
      parseProductStructuredData(
        document,
        'https://store.epicgames.com/p/base-game',
      )?.pagePrice,
    ).toEqual({
      amount: 1299,
      currencyCode: 'EUR',
    });
  });

  it('normalizes price text and finds the primary strong price element', () => {
    document.body.innerHTML = `
      <strong>PEGI 12</strong>
      <span><strong>10,52&nbsp;€*</strong></span>
    `;

    expect(normalizePriceText('10,52\u00a0€*')).toBe('10,52 €');
    expect(
      findPrimaryPriceElement(
        document,
        { amount: 1052, currencyCode: 'EUR' },
        'es-ES',
      ),
    ).toBe(document.querySelector('span strong'));
  });

  it('derives country candidates from URL locale or document locale', () => {
    expect(
      deriveCountryCandidateFromLocale(
        'https://store.epicgames.com/en-US/p/game-one',
        'es-ES',
      ),
    ).toBe('US');
    expect(
      deriveCountryCandidateFromLocale(
        'https://store.epicgames.com/p/game-one',
        'es-ES',
      ),
    ).toBe('ES');
  });
});
