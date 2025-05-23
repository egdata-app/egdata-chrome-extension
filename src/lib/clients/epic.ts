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
export class EpicGamesGraphQLClient {
  public client: ApolloClient<NormalizedCacheObject>;
  private logger = consola.withTag('epic-client');

  constructor({ token }: { token: string }) {
    this.logger.info('Initializing Epic Games GraphQL client');
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
    this.logger.info('Getting Epic Games library', {
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

      this.logger.info('Epic Games library URL', url);

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }).catch((error) => {
        this.logger.error('Error fetching Epic Games library:', error);
        throw error;
      });

      const data = await response.json();

      this.logger.info('Epic Games library data', {
        hasItems: !!data.items,
        itemsLength: data.items?.length,
        dataKeys: Object.keys(data),
        firstItem: data.items?.[0],
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
