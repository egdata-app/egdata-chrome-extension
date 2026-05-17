import { extractUniqueCatalogItemIds } from '@/lib/services/library-utils';
import type { Record as LibraryRecord } from '@/types/get-library';
import { describe, expect, it } from 'vitest';

describe('library sync helpers', () => {
  it('extracts unique catalog item IDs and drops empty values', () => {
    const records = [
      { catalogItemId: 'item-1' },
      { catalogItemId: 'item-2' },
      { catalogItemId: 'item-1' },
      { catalogItemId: '' },
    ] as LibraryRecord[];

    expect(extractUniqueCatalogItemIds(records)).toEqual(['item-1', 'item-2']);
  });
});
