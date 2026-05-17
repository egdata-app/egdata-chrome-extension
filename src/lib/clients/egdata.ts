import type {
  EgdataOffer,
  PaginatedEgdataResponse,
} from "@/types/egdata";

const BASE_URL = "https://api.egdata.app";

class EgdataApiClient {
  private async request<T>(
    path: string,
    params: Record<string, string | number | boolean | undefined> = {},
  ) {
    const url = new URL(path, BASE_URL);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`egdata request failed: ${response.status}`);
    }

    return response.json() as Promise<T>;
  }

  getFreeGames(country: string) {
    return this.request<EgdataOffer[]>("/free-games", { country });
  }

  getLatestReleased(country: string, limit = 12) {
    return this.request<PaginatedEgdataResponse<EgdataOffer>>(
      "/offers/latest-released",
      { country, limit },
    );
  }

  getLatestAchievements(country: string) {
    return this.request<EgdataOffer[]>("/offers/latest-achievements", {
      country,
    });
  }

  getTopSellers(country: string, limit = 12) {
    return this.request<PaginatedEgdataResponse<EgdataOffer>>("/offers", {
      slug: "top-sellers",
      country,
      limit,
      page: 1,
    });
  }

  getOfferOverview(offerId: string, country: string) {
    return this.request<EgdataOffer>(`/offers/${offerId}/overview`, {
      country,
    });
  }

  getOffer(offerId: string, country: string) {
    return this.request<EgdataOffer>(`/offers/${offerId}`, {
      country,
      limit: 1,
    });
  }

  resolveSlugs(slugs: string[]) {
    return fetch(`${BASE_URL}/offers/slugs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ slugs }),
    }).then((response) => {
      if (!response.ok) {
        throw new Error(`Failed to resolve slugs: ${response.status}`);
      }

      return response.json() as Promise<
        Array<{
          slug: string;
          id: string | null;
          namespace: string | null;
        }>
      >;
    });
  }
}

export const egdataClient = new EgdataApiClient();
