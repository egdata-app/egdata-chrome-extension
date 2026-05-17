import {
  ApolloClient,
  InMemoryCache,
  type NormalizedCacheObject,
} from '@apollo/client';
import consola from 'consola';
import {
  GetOffersValidationDocument,
  type GetOffersValidationQuery,
  type GetOffersValidationQueryVariables,
} from '../queries/get-owned-offers';

interface OfferValidation {
  namespace: string;
  offerId: string;
}

interface OfferValidationResponse {
  conflictingOffers: OfferValidation[];
  missingPrerequisites: OfferValidation[];
  fullyOwnedOffers: OfferValidation[];
  possiblePartialUpgradeOffers: OfferValidation[];
  unablePartiallyUpgradeOffers: OfferValidation[];
}

export async function getOffersValidation(
  offers: {
    namespace: string;
    id?: string;
    offerId?: string;
  }[],
  token: string,
): Promise<OfferValidationResponse> {
  const response = await fetch(
    'https://api.egdata.app/users-service/ownership',
    {
      method: 'POST',
      body: JSON.stringify(
        offers.map((offer) => ({
          namespace: offer.namespace,
          id: offer.id ?? offer.offerId,
        })),
      ),
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to validate offers: ${response.status}`);
  }

  return response.json() as Promise<OfferValidationResponse>;
}

export class EpicGamesGraphQLClient {
  public client: ApolloClient<NormalizedCacheObject>;
  private logger = consola.withTag('epic-client');

  constructor({ token }: { token: string }) {
    this.logger.debug('Initializing Epic Games GraphQL client');
    this.client = new ApolloClient({
      uri: 'https://store.epicgames.com/graphql',
      cache: new InMemoryCache(),
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  }

  async getLibrary({
    token,
    includeMetadata,
    cursor,
    excludeNs,
    includeNs,
    limit,
    platform,
    includeCategories,
  }: {
    token: string;
    includeMetadata?: boolean;
    cursor?: string;
    excludeNs?: string[];
    includeNs?: string[];
    limit?: number;
    platform?: string;
    includeCategories?: string[];
  }) {
    this.logger.debug('Getting Epic Games library', {
      includeMetadata,
      cursor,
      excludeNs,
      includeNs,
      limit,
      platform,
      includeCategories,
    });

    try {
      if (!token) {
        this.logger.error('No token found');
        throw new Error('No token found');
      }

      const url = new URL(
        'https://library-service.live.use1a.on.epicgames.com/library/api/public/items',
      );

      if (includeMetadata) {
        url.searchParams.set('includeMetadata', 'true');
      }

      if (cursor) {
        url.searchParams.set('cursor', cursor);
      }

      if (excludeNs) {
        for (const ns of excludeNs) {
          url.searchParams.append('excludeNs', ns);
        }
      }

      if (includeNs) {
        for (const ns of includeNs) {
          url.searchParams.append('includeNs', ns);
        }
      }

      if (limit) {
        url.searchParams.set('limit', limit.toString());
      }

      if (platform) {
        url.searchParams.set('platform', platform);
      }

      if (includeCategories) {
        for (const category of includeCategories) {
          url.searchParams.append('includeCategories', category);
        }
      }

      this.logger.debug('Epic Games library URL', url.toString());

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }).catch((error) => {
        this.logger.error('Error fetching Epic Games library:', error);
        throw error;
      });

      if (!response.ok) {
        throw new Error(
          `Failed to fetch Epic Games library: ${response.status}`,
        );
      }

      const data = await response.json();

      this.logger.debug('Epic Games library data', {
        hasRecords: !!data.records,
        recordsLength: data.records?.length,
        dataKeys: Object.keys(data),
      });

      return data;
    } catch (error) {
      this.logger.error('Error getting Epic Games library:', error);
      throw error;
    }
  }

  async getOffersValidation({
    offers,
  }: {
    offers: {
      namespace: string;
      offerId: string;
    }[];
  }) {
    const response = await this.client.query<
      GetOffersValidationQuery,
      GetOffersValidationQueryVariables
    >({
      query: GetOffersValidationDocument,
      variables: {
        offers,
      },
    });

    return response.data;
  }
}
