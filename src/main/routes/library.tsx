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
import {
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { Offer } from "@/types/offer";

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

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger>
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
      </ContextMenuTrigger>
      <ContextMenuContent>
        <DynamicItems id={game.id} />
        <ContextMenuItem onClick={() => handleCopy(game.id)}>
          Copy ID
        </ContextMenuItem>
        <ContextMenuItem onClick={() => handleCopy(game.namespace)}>
          Copy namespace
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function DynamicItems({ id }: { id: string }) {
  const {
    data: offer,
    isLoading: isOfferLoading,
    isError: isOfferError,
  } = useQuery({
    queryKey: ["item", "base-offer", id],
    queryFn: () =>
      fetch(`https://api-gcp.egdata.app/items/${id}/offer`).then(
        (res) => res.json() as Promise<Offer | { error: string }>
      ),
  });

  if ((isOfferError || !offer || "error" in offer) && !isOfferLoading) {
    return null;
  }

  if (isOfferLoading) {
    return (
      <>
        <ContextMenuItem disabled>
          <Loader2 className="h-4 w-4 animate-spin" />
          Open in Epic Games Store
        </ContextMenuItem>
        <ContextMenuItem disabled>
          <Loader2 className="h-4 w-4 animate-spin" />
          Open egdata.app
        </ContextMenuItem>
      </>
    );
  }

  if (!offer) {
    return null;
  }

  const calculateSlug = (offer: Offer) => {
    const urlType: "product" | "url" =
      offer.offerType === "BASE_GAME" ? "product" : "url";
    const isBundle = offer.offerType === "BUNDLE";
    const namespace = isBundle ? "bundles" : "product";
    const url =
      offer.customAttributes?.["com.epicgames.app.productSlug"]?.value ??
      offer.offerMappings?.[0]?.pageSlug ??
      offer.urlSlug ??
      (urlType === "product" ? offer.productSlug : offer.urlSlug);

    if (!url) {
      return null;
    }

    const storeUrl = `https://egdata.app/store/${namespace}/${url.replaceAll(
      "-pp",
      ""
    )}?id=${offer.id}&ns=${offer.namespace}`;

    return storeUrl;
  };

  const storeUrl = calculateSlug(offer as Offer);

  return (
    <>
      <ContextMenuItem
        onClick={() => {
          if (storeUrl) {
            window.open(storeUrl, "_blank");
          }
        }}
        disabled={!storeUrl}
      >
        {storeUrl ? "Open Epic Games Store" : "No store URL found"}
      </ContextMenuItem>
      <ContextMenuItem
        onClick={() =>
          window.open(
            `https://egdata.app/offers/${(offer as Offer).id}`,
            "_blank"
          )
        }
      >
        Open egdata.app
      </ContextMenuItem>
    </>
  );
}

function RouteComponent() {
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"lastModifiedDate" | "title">(
    "lastModifiedDate"
  );
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [isSyncing, setIsSyncing] = useState(false);
  const pageSize = 16;

  const {
    data: searchResult,
    isLoading: isItemsLoading,
    error: itemsError,
    refetch: refetchItems,
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

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      const response = await chrome.runtime.sendMessage({
        action: "syncLibrary",
      });
      if (response.error) {
        throw new Error(response.error);
      }
      toast.success("Library sync completed successfully");
      // Refetch items to show updated data
      await refetchItems();
    } catch (error) {
      consola.error("Failed to sync library", error);
      toast.error("Failed to sync library");
    } finally {
      setIsSyncing(false);
    }
  };

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
        <div className="flex justify-between items-center">
          <h1 className="text-3xl font-bold">Your Epic Games Library</h1>
          <Button
            onClick={handleSync}
            disabled={isSyncing}
            variant="outline"
            className="gap-2"
          >
            <RefreshCw
              className={`h-4 w-4 ${isSyncing ? "animate-spin" : ""}`}
            />
            {isSyncing ? "Syncing..." : "Sync Library"}
          </Button>
        </div>

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
