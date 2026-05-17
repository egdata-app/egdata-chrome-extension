import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { egdataClient } from '@/lib/clients/egdata';
import { messagingClient } from '@/lib/clients/messaging';
import {
  daysUntil,
  formatDateTime,
  formatDiscount,
  formatPrice,
  getBestImage,
  getEgdataOfferUrl,
  getOfferStoreUrl,
  normalizeOfferKey,
} from '@/lib/offer-utils';
import type { EgdataOffer, WatchlistItem } from '@/types/egdata';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  ExternalLink,
  Gift,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Star,
} from 'lucide-react';
import { toast } from 'sonner';

export const Route = createFileRoute('/')({
  component: TodayRoute,
});

function TodayRoute() {
  const queryClient = useQueryClient();
  const healthQuery = useQuery({
    queryKey: ['health'],
    queryFn: () => messagingClient.getHealth(),
  });
  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: () => messagingClient.getSettings(),
  });
  const country =
    settingsQuery.data?.country ?? healthQuery.data?.country ?? 'US';
  const freeGamesQuery = useQuery({
    queryKey: ['free-games', country],
    queryFn: () => messagingClient.getFreeGames(),
  });
  const watchlistQuery = useQuery({
    queryKey: ['watchlist'],
    queryFn: () => messagingClient.getWatchlist(),
  });
  const changesQuery = useQuery({
    queryKey: ['library-changes'],
    queryFn: () => messagingClient.getLibraryChanges(),
  });
  const latestQuery = useQuery({
    queryKey: ['latest-released', country],
    queryFn: () => egdataClient.getLatestReleased(country, 6),
  });
  const sellersQuery = useQuery({
    queryKey: ['top-sellers', country],
    queryFn: () => egdataClient.getTopSellers(country, 6),
  });

  const syncMutation = useMutation({
    mutationFn: () => messagingClient.syncLibrary(),
    onSuccess: async () => {
      toast.success('Library sync completed');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['health'] }),
        queryClient.invalidateQueries({ queryKey: ['library-changes'] }),
      ]);
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Library sync failed',
      );
    },
  });

  const watchMutation = useMutation({
    mutationFn: (offer: EgdataOffer) =>
      messagingClient.updateWatchlist({
        type: 'upsert',
        item: offerToWatchlistItem(offer, country),
      }),
    onSuccess: async () => {
      toast.success('Added to watchlist');
      await queryClient.invalidateQueries({ queryKey: ['watchlist'] });
      await queryClient.invalidateQueries({ queryKey: ['health'] });
    },
  });

  const watchlist = watchlistQuery.data ?? [];
  const watchedKeys = new Set(watchlist.map((item) => item.key));
  const freeGames = freeGamesQuery.data ?? [];
  const latestOffers = latestQuery.data?.elements ?? [];
  const topSellers = sellersQuery.data?.elements ?? [];
  const health = healthQuery.data;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 overflow-y-auto px-2 pb-10 pt-2">
      <section className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            Epic Games Store assistant
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">Today</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
          >
            {syncMutation.isPending ? (
              <Loader2 className="animate-spin" />
            ) : (
              <RefreshCw />
            )}
            Sync library
          </Button>
          <Button asChild>
            <a
              href="https://store.epicgames.com"
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink />
              Open Epic
            </a>
          </Button>
        </div>
      </section>

      {!healthQuery.isLoading && !health?.isAuthenticated && (
        <Card className="border-amber-500/40 bg-amber-500/10">
          <CardContent className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 text-amber-300" />
              <div>
                <p className="font-medium">Epic login is missing</p>
                <p className="text-sm text-muted-foreground">
                  Sign in on the Epic Games Store, then sync your library.
                </p>
              </div>
            </div>
            <Button asChild variant="outline">
              <a
                href="https://store.epicgames.com"
                target="_blank"
                rel="noreferrer"
              >
                Open login
              </a>
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <HealthCard
          icon={<ShieldCheck />}
          label="Epic account"
          value={health?.isAuthenticated ? 'Connected' : 'Needs login'}
          detail={
            health?.lastSyncError ?? 'Cookie auth from store.epicgames.com'
          }
        />
        <HealthCard
          icon={<CheckCircle2 />}
          label="Owned items"
          value={
            healthQuery.isLoading ? '...' : String(health?.ownedItemCount ?? 0)
          }
          detail={`Last sync ${formatDateTime(health?.lastSyncAt)}`}
        />
        <HealthCard
          icon={<Star />}
          label="Watchlist"
          value={String(health?.watchlistCount ?? watchlist.length)}
          detail="Local price checks and in-app reminders"
        />
        <HealthCard
          icon={<Bell />}
          label="Alerts"
          value={health?.notificationsEnabled ? 'Enabled' : 'Opt-in'}
          detail={
            health?.overlayEnabled ? 'Store overlay active' : 'Overlay disabled'
          }
        />
      </div>

      <section className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Gift className="text-emerald-300" />
              Current Free Games
            </CardTitle>
            <CardDescription>
              In-app reminders are shown here. OS notifications stay opt-in.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {freeGamesQuery.isLoading ? (
              <LoadingRow label="Loading free games" />
            ) : freeGamesQuery.isError ? (
              <EmptyState
                title="Free games unavailable"
                detail="egdata did not return free-game data right now."
              />
            ) : freeGames.length === 0 ? (
              <EmptyState
                title="No free games found"
                detail="Check back after the next Epic rotation."
              />
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {freeGames.slice(0, 4).map((offer) => (
                  <OfferCard
                    key={offer.id}
                    offer={offer}
                    isWatched={watchedKeys.has(
                      normalizeOfferKey(offer.namespace, offer.id),
                    )}
                    onWatch={() => watchMutation.mutate(offer)}
                    compact
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Library Changes</CardTitle>
            <CardDescription>
              Based on the most recent local sync snapshot.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {changesQuery.isLoading ? (
              <LoadingRow label="Reading sync snapshot" />
            ) : (
              <>
                <MetricLine
                  label="New items"
                  value={changesQuery.data?.addedItems.length ?? 0}
                />
                <MetricLine
                  label="Removed IDs"
                  value={changesQuery.data?.removedItemIds.length ?? 0}
                />
                <MetricLine
                  label="Updated metadata"
                  value={changesQuery.data?.updatedItemIds.length ?? 0}
                />
                <div className="space-y-2">
                  {(changesQuery.data?.addedItems ?? [])
                    .slice(0, 4)
                    .map((item) => (
                      <div
                        key={item.id}
                        className="rounded-md border border-border/70 px-3 py-2 text-sm"
                      >
                        <p className="font-medium">{item.title}</p>
                        <p className="text-xs text-muted-foreground">
                          Acquired {formatDateTime(item.acquisitionDate)}
                        </p>
                      </div>
                    ))}
                </div>
                <Button asChild variant="outline" className="w-full">
                  <Link to="/library">Open library audit</Link>
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <OfferSection
          title="Watched Deals"
          emptyTitle="No watched offers yet"
          emptyDetail="Watch an offer from this dashboard, the library detail panel, or a store overlay."
        >
          {watchlist.slice(0, 6).map((item) => (
            <WatchlistRow key={item.key} item={item} />
          ))}
        </OfferSection>

        <OfferSection
          title="Top Sellers"
          emptyTitle="Top sellers unavailable"
          emptyDetail="The egdata offer list could not be loaded."
        >
          {topSellers.map((offer) => (
            <OfferRow
              key={offer.id}
              offer={offer}
              isWatched={watchedKeys.has(
                normalizeOfferKey(offer.namespace, offer.id),
              )}
              onWatch={() => watchMutation.mutate(offer)}
            />
          ))}
        </OfferSection>
      </section>

      <OfferSection
        title="Latest Releases"
        emptyTitle="Latest releases unavailable"
        emptyDetail="The egdata latest release endpoint did not respond."
      >
        {latestOffers.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {latestOffers.map((offer) => (
              <OfferCard
                key={offer.id}
                offer={offer}
                isWatched={watchedKeys.has(
                  normalizeOfferKey(offer.namespace, offer.id),
                )}
                onWatch={() => watchMutation.mutate(offer)}
              />
            ))}
          </div>
        ) : null}
      </OfferSection>
    </div>
  );
}

function HealthCard({
  icon,
  label,
  value,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <Card className="rounded-lg py-4">
      <CardContent className="flex items-start gap-3 px-4">
        <div className="rounded-md border border-border bg-secondary p-2 text-muted-foreground">
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="truncate text-lg font-semibold">{value}</p>
          <p className="truncate text-xs text-muted-foreground">{detail}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function OfferSection({
  title,
  emptyTitle,
  emptyDetail,
  children,
}: {
  title: string;
  emptyTitle: string;
  emptyDetail: string;
  children: React.ReactNode;
}) {
  const hasChildren = Array.isArray(children)
    ? children.length > 0
    : Boolean(children);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {hasChildren ? (
          children
        ) : (
          <EmptyState title={emptyTitle} detail={emptyDetail} />
        )}
      </CardContent>
    </Card>
  );
}

function OfferCard({
  offer,
  isWatched,
  onWatch,
  compact = false,
}: {
  offer: EgdataOffer;
  isWatched: boolean;
  onWatch: () => void;
  compact?: boolean;
}) {
  const image = getBestImage(offer.keyImages, compact);
  const price = offer.price?.price;
  const discount = formatDiscount(price);
  const endingDays = daysUntil(offer.giveaway?.endDate);
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-secondary/20">
      {image && (
        <img
          src={image.url}
          alt={offer.title}
          className={
            compact ? 'h-28 w-full object-cover' : 'h-36 w-full object-cover'
          }
        />
      )}
      <div className="space-y-3 p-3">
        <div>
          <p className="line-clamp-2 font-medium">{offer.title}</p>
          <p className="text-xs text-muted-foreground">
            {offer.developerDisplayName ??
              offer.publisherDisplayName ??
              'Unknown'}
          </p>
        </div>
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="font-medium">{formatPrice(price)}</span>
          {discount && (
            <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-xs text-emerald-200">
              {discount}
            </span>
          )}
          {endingDays != null && (
            <span className="text-xs text-muted-foreground">
              {endingDays <= 0 ? 'Ending today' : `${endingDays}d left`}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={onWatch}
            disabled={isWatched}
          >
            <Star />
            {isWatched ? 'Watched' : 'Watch'}
          </Button>
          <Button size="sm" variant="ghost" asChild>
            <a
              href={getEgdataOfferUrl(offer.id)}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink />
            </a>
          </Button>
        </div>
      </div>
    </div>
  );
}

function OfferRow({
  offer,
  isWatched,
  onWatch,
}: {
  offer: EgdataOffer;
  isWatched: boolean;
  onWatch: () => void;
}) {
  const image = getBestImage(offer.keyImages, true);
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border/70 p-2">
      {image && (
        <img
          src={image.url}
          alt={offer.title}
          className="h-14 w-11 rounded object-cover"
        />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{offer.title}</p>
        <p className="text-xs text-muted-foreground">
          {formatPrice(offer.price?.price)}
        </p>
      </div>
      <Button
        size="icon"
        variant="ghost"
        onClick={onWatch}
        disabled={isWatched}
      >
        <Star className={isWatched ? 'fill-current' : ''} />
      </Button>
    </div>
  );
}

function WatchlistRow({ item }: { item: WatchlistItem }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border/70 p-2">
      {item.imageUrl && (
        <img
          src={item.imageUrl}
          alt={item.title}
          className="h-14 w-11 rounded object-cover"
        />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{item.title}</p>
        <p className="text-xs text-muted-foreground">
          {formatPrice(item.currentPrice)}
          {item.targetPrice != null
            ? ` target ${formatPrice({
                currencyCode: item.currentPrice?.currencyCode ?? 'USD',
                originalPrice: item.targetPrice,
                discountPrice: item.targetPrice,
                discount: 0,
              })}`
            : ' no target'}
        </p>
      </div>
      <Button asChild size="icon" variant="ghost">
        <a href={item.egdataUrl} target="_blank" rel="noreferrer">
          <ExternalLink />
        </a>
      </Button>
    </div>
  );
}

function MetricLine({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between rounded-md bg-secondary/30 px-3 py-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="font-mono text-sm">{value}</span>
    </div>
  );
}

function LoadingRow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="animate-spin" />
      {label}
    </div>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center">
      <p className="font-medium">{title}</p>
      <p className="text-sm text-muted-foreground">{detail}</p>
    </div>
  );
}

function offerToWatchlistItem(
  offer: EgdataOffer,
  country: string,
): Omit<WatchlistItem, 'key' | 'createdAt' | 'updatedAt'> {
  return {
    offerId: offer.id,
    namespace: offer.namespace,
    title: offer.title,
    country,
    targetPrice: null,
    currentPrice: offer.price?.price ?? null,
    lastSeenPrice: offer.price?.price ?? null,
    lastNotifiedPrice: null,
    imageUrl: getBestImage(offer.keyImages, true)?.url ?? null,
    storeUrl: getOfferStoreUrl(offer),
    egdataUrl: getEgdataOfferUrl(offer.id),
  };
}
