import { messagingClient } from "@/lib/clients/messaging";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import consola from "consola";
import { librarySyncService } from "@/lib/services/library-sync";
import type { Item } from "@/types/item";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react";

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

function GameCard({ game }: { game: Item }) {
  // Find the best cover image
  const cover =
    game.keyImages.find((img) => img.type === "OfferImageWide") ||
    game.keyImages[0];

  return (
    <Card className="group overflow-hidden transition-transform hover:scale-105 p-0">
      <CardContent className="p-0">
        {/* Cover Image */}
        {cover && (
          <div className="relative aspect-video">
            <img
              src={cover.url}
              alt={game.title}
              className="w-full h-full object-cover"
            />
            {/* Overlay gradient for title */}
            <div className="absolute bottom-0 left-0 w-full bg-gradient-to-t from-black/80 to-transparent p-4">
              <span className="text-lg font-bold text-white drop-shadow-md">
                {game.title}
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RouteComponent() {
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"lastModifiedDate" | "title">(
    "lastModifiedDate"
  );
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const pageSize = 16;

  const {
    data: searchResult,
    isLoading: isItemsLoading,
    error: itemsError,
  } = useQuery({
    queryKey: ["library-items", page, searchQuery, sortBy, sortOrder],
    queryFn: () =>
      librarySyncService.searchItems({
        page,
        pageSize,
        searchQuery,
        sortBy,
        sortOrder,
      }),
    placeholderData: keepPreviousData,
  });

  if (isItemsLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-xl text-muted-foreground">
          Loading your library...
        </div>
      </div>
    );
  }

  if (itemsError) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-xl text-destructive">
          Error: {itemsError?.message}
        </div>
      </div>
    );
  }

  if (!searchResult) {
    return null;
  }

  const { items, pagination } = searchResult;

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex flex-col gap-6 mb-8">
        <h1 className="text-3xl font-bold">Your Epic Games Library</h1>

        {/* Search and Sort Controls */}
        <div className="flex flex-col sm:flex-row gap-4">
          <Input
            type="text"
            placeholder="Search games..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setPage(1); // Reset to first page when search changes
            }}
            className="flex-1"
          />
          <div className="flex gap-2">
            <Select
              value={sortBy}
              onValueChange={(value: "lastModifiedDate" | "title") =>
                setSortBy(value)
              }
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="lastModifiedDate">Last Modified</SelectItem>
                <SelectItem value="title">Title</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setSortOrder(sortOrder === "asc" ? "desc" : "asc")}
            >
              <ArrowUpDown className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Game Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {items.map((game) => (
          <GameCard key={game.id} game={game} />
        ))}
      </div>

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="flex justify-center gap-2 mt-8">
          <Button
            variant="outline"
            onClick={() => setPage(page - 1)}
            disabled={page === 1}
          >
            <ChevronLeft className="h-4 w-4 mr-2" />
            Previous
          </Button>
          <div className="flex items-center px-4 text-muted-foreground">
            Page {page} of {pagination.totalPages}
          </div>
          <Button
            variant="outline"
            onClick={() => setPage(page + 1)}
            disabled={page === pagination.totalPages}
          >
            Next
            <ChevronRight className="h-4 w-4 ml-2" />
          </Button>
        </div>
      )}
    </div>
  );
}
