import { messagingClient } from "@/lib/clients/messaging";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useInfiniteQuery, type InfiniteData } from "@tanstack/react-query";
import consola from "consola";
import type { LibraryResponse, Record } from "@/types/get-library";

export const Route = createFileRoute("/library")({
  component: RouteComponent,
  loader: async () => {
    const token = await messagingClient.getEpicToken();

    if (!token) {
      consola.error("No token found");
      throw redirect({ to: "/" });
    }

    return { token };
  },
});

function GameCard({ game }: { game: Record }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-shadow">
      <div className="p-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
          {game.appName}
        </h3>
        <div className="text-sm text-gray-600 dark:text-gray-300 space-y-1">
          <p>Namespace: {game.namespace}</p>
          <p>Product ID: {game.productId}</p>
          <p>Acquired: {new Date(game.acquisitionDate).toLocaleDateString()}</p>
        </div>
      </div>
    </div>
  );
}

function RouteComponent() {
  const { token } = Route.useLoaderData();

  const {
    data,
    isLoading,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery<
    LibraryResponse,
    Error,
    InfiniteData<LibraryResponse>,
    string[],
    string | undefined
  >({
    queryKey: ["library", token],
    queryFn: ({ pageParam }) =>
      messagingClient.getLibrary({ cursor: pageParam }),
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage.responseMetadata.nextCursor,
    enabled: !!token,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-xl text-gray-600 dark:text-gray-300">
          Loading your library...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-xl text-red-600 dark:text-red-400">
          Error: {error.message}
        </div>
      </div>
    );
  }

  if (!data) {
    return null;
  }

  const allGames = data.pages.flatMap((page) => page.records);

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-8">
        Your Epic Games Library
      </h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {allGames.map((game) => (
          <GameCard key={`${game.namespace}-${game.productId}`} game={game} />
        ))}
      </div>

      {hasNextPage && (
        <div className="mt-8 flex justify-center">
          <button
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isFetchingNextPage ? "Loading more games..." : "Load More Games"}
          </button>
        </div>
      )}
    </div>
  );
}
