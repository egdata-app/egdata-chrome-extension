import type { Record as LibraryRecord } from '@/types/get-library';

export function extractUniqueCatalogItemIds(
  records: LibraryRecord[],
): string[] {
  return Array.from(
    new Set(
      records
        .map((record) => record.catalogItemId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  );
}
