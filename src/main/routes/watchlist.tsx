import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { messagingClient } from "@/lib/clients/messaging";
import { formatDateTime, formatPrice } from "@/lib/offer-utils";
import type { WatchlistItem } from "@/types/egdata";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ExternalLink, Loader2, RefreshCw, Save, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/watchlist")({
  component: WatchlistRoute,
});

function WatchlistRoute() {
  const queryClient = useQueryClient();
  const watchlistQuery = useQuery({
    queryKey: ["watchlist"],
    queryFn: () => messagingClient.getWatchlist(),
  });
  const checkMutation = useMutation({
    mutationFn: () => messagingClient.checkWatchlist(),
    onSuccess: async (result) => {
      toast.success(result.summary);
      await queryClient.invalidateQueries({ queryKey: ["watchlist"] });
    },
  });

  const items = watchlistQuery.data ?? [];

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 overflow-y-auto px-2 pb-10 pt-2">
      <section className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">Local price tracking</p>
          <h1 className="text-3xl font-semibold tracking-tight">Watchlist</h1>
        </div>
        <Button
          variant="outline"
          onClick={() => checkMutation.mutate()}
          disabled={checkMutation.isPending}
        >
          {checkMutation.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          Check prices
        </Button>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>{items.length} watched offer{items.length === 1 ? "" : "s"}</CardTitle>
          <CardDescription>
            Alerts are opt-in from Settings. Targets are stored locally in this browser.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {watchlistQuery.isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="animate-spin" />
              Loading watchlist
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center">
              <p className="font-medium">No watched offers</p>
              <p className="text-sm text-muted-foreground">
                Add offers from Today, Library details, or Epic Store overlays.
              </p>
            </div>
          ) : (
            items.map((item) => <WatchlistEditor key={item.key} item={item} />)
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function WatchlistEditor({ item }: { item: WatchlistItem }) {
  const queryClient = useQueryClient();
  const [targetPrice, setTargetPrice] = useState(
    item.targetPrice != null ? (item.targetPrice / 100).toString() : "",
  );
  const updateMutation = useMutation({
    mutationFn: () =>
      messagingClient.updateWatchlist({
        type: "upsert",
        item: {
          ...item,
          targetPrice:
            targetPrice.trim() === ""
              ? null
              : Math.max(0, Math.round(Number(targetPrice) * 100)),
        },
      }),
    onSuccess: async () => {
      toast.success("Watch target saved");
      await queryClient.invalidateQueries({ queryKey: ["watchlist"] });
    },
  });
  const removeMutation = useMutation({
    mutationFn: () =>
      messagingClient.updateWatchlist({
        type: "remove",
        namespace: item.namespace,
        offerId: item.offerId,
      }),
    onSuccess: async () => {
      toast.success("Removed from watchlist");
      await queryClient.invalidateQueries({ queryKey: ["watchlist"] });
    },
  });

  return (
    <div className="grid gap-3 rounded-lg border border-border/70 p-3 md:grid-cols-[auto_1fr_auto] md:items-center">
      {item.imageUrl ? (
        <img src={item.imageUrl} alt={item.title} className="h-20 w-16 rounded object-cover" />
      ) : (
        <div className="h-20 w-16 rounded bg-secondary" />
      )}
      <div className="min-w-0 space-y-1">
        <p className="truncate font-medium">{item.title}</p>
        <p className="text-sm text-muted-foreground">
          Current {formatPrice(item.currentPrice)} - Last checked{" "}
          {formatDateTime(item.lastCheckedAt)}
        </p>
        <p className="truncate font-mono text-xs text-muted-foreground">
          {item.namespace}:{item.offerId}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={targetPrice}
          onChange={(event) => setTargetPrice(event.target.value)}
          className="w-28"
          inputMode="decimal"
          placeholder="Target"
        />
        <Button
          variant="outline"
          size="icon"
          onClick={() => updateMutation.mutate()}
          disabled={updateMutation.isPending}
          title="Save target"
        >
          <Save />
        </Button>
        <Button asChild variant="ghost" size="icon" title="Open egdata">
          <a href={item.egdataUrl} target="_blank" rel="noreferrer">
            <ExternalLink />
          </a>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => removeMutation.mutate()}
          disabled={removeMutation.isPending}
          title="Remove"
        >
          <Trash2 />
        </Button>
      </div>
    </div>
  );
}
