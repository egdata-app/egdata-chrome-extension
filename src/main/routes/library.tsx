import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { messagingClient } from "@/lib/clients/messaging";
import {
  downloadTextFile,
  formatDateTime,
  getBestImage,
  getEgdataOfferUrl,
  getItemCategoryText,
  getOfferStoreUrl,
  itemHasStorePage,
  toCsv,
} from "@/lib/offer-utils";
import {
  librarySyncService,
  type LibraryItemRecord,
  type LibrarySearchFilters,
} from "@/lib/services/library-sync";
import type { Offer } from "@/types/offer";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import {
  ArrowDownAZ,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  Grid2X2,
  List,
  Loader2,
  RefreshCw,
  Search,
  Star,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/library")({
  component: LibraryRoute,
  loader: async () => {
    try {
      const token = await messagingClient.getEpicToken();
      if (!token) {
        throw redirect({ to: "/" });
      }
      return { token };
    } catch {
      throw redirect({ to: "/" });
    }
  },
});

function LibraryRoute() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<
    "lastModifiedDate" | "title" | "acquisitionDate" | "developer"
  >("acquisitionDate");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [view, setView] = useState<"grid" | "table">("table");
  const [selectedItem, setSelectedItem] = useState<LibraryItemRecord | null>(
    null,
  );
  const [filters, setFilters] = useState<LibrarySearchFilters>({
    unsearchable: "all",
    endOfSupport: "all",
    requiresSecureAccount: "all",
    storePage: "all",
  });
  const pageSize = view === "grid" ? 24 : 20;

  const searchResultQuery = useQuery({
    queryKey: ["library-items", page, pageSize, searchQuery, sortBy, sortOrder, filters],
    queryFn: () =>
      librarySyncService.searchItems({
        page,
        pageSize,
        searchQuery,
        sortBy,
        sortOrder,
        filters,
      }),
    placeholderData: keepPreviousData,
  });

  const filterOptionsQuery = useQuery({
    queryKey: ["library-filter-options"],
    queryFn: () => librarySyncService.getFilterOptions(),
  });

  const syncMutation = useMutation({
    mutationFn: () =>
      messagingClient.sendMessage<{ success?: boolean; error?: string }>({
        action: "syncLibrary",
      }),
    onSuccess: async (response) => {
      if (response.error) {
        throw new Error(response.error);
      }
      toast.success("Library sync completed");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["library-items"] }),
        queryClient.invalidateQueries({ queryKey: ["library-filter-options"] }),
      ]);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Library sync failed");
    },
  });

  const searchResult = searchResultQuery.data;
  const items = searchResult?.items ?? [];
  const allItems = searchResult?.allItems ?? [];
  const pagination = searchResult?.pagination;
  const filterOptions = filterOptionsQuery.data;

  const exportRows = useMemo(
    () =>
      allItems.map((item) => ({
        id: item.id,
        namespace: item.namespace,
        title: item.title,
        developer: item.developer,
        itemType: item.itemType,
        status: item.status,
        acquisitionDate: item.acquisitionDate ?? "",
        categories: getItemCategoryText(item),
        platforms: item.releaseInfo
          .flatMap((release) => release.platform)
          .join("|"),
        unsearchable: item.unsearchable,
        endOfSupport: item.endOfSupport,
        requiresSecureAccount: item.requiresSecureAccount,
        hasStorePage: itemHasStorePage(item),
      })),
    [allItems],
  );

  const updateFilter = <K extends keyof LibrarySearchFilters>(
    key: K,
    value: LibrarySearchFilters[K] | "all",
  ) => {
    setFilters((current) => ({
      ...current,
      [key]: value === "all" ? undefined : value,
    }));
    setPage(1);
  };

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 overflow-y-auto px-2 pb-10 pt-2">
      <section className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">Search, audit, and export</p>
          <h1 className="text-3xl font-semibold tracking-tight">Library</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
          >
            {syncMutation.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Sync
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              downloadTextFile(
                "egdata-library.csv",
                toCsv(exportRows, [
                  { key: "title", label: "Title" },
                  { key: "id", label: "Item ID" },
                  { key: "namespace", label: "Namespace" },
                  { key: "developer", label: "Developer" },
                  { key: "itemType", label: "Item type" },
                  { key: "status", label: "Status" },
                  { key: "acquisitionDate", label: "Acquired" },
                  { key: "categories", label: "Categories" },
                  { key: "platforms", label: "Platforms" },
                  { key: "unsearchable", label: "Unsearchable" },
                  { key: "endOfSupport", label: "End of support" },
                  { key: "requiresSecureAccount", label: "Secure account" },
                  { key: "hasStorePage", label: "Store page" },
                ]),
                "text/csv",
              )
            }
            disabled={exportRows.length === 0}
          >
            <Download />
            CSV
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              downloadTextFile(
                "egdata-library.json",
                JSON.stringify(allItems, null, 2),
                "application/json",
              )
            }
            disabled={allItems.length === 0}
          >
            <Download />
            JSON
          </Button>
        </div>
      </section>

      <Card>
        <CardContent className="space-y-4 py-4">
          <div className="grid gap-3 xl:grid-cols-[1.4fr_repeat(3,1fr)]">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                  setPage(1);
                }}
                className="pl-9"
                placeholder="Search by title, developer, namespace, category..."
              />
            </div>
            <FilterSelect
              label="Sort"
              value={sortBy}
              onValueChange={(value) =>
                setSortBy(
                  value as "lastModifiedDate" | "title" | "acquisitionDate" | "developer",
                )
              }
              options={[
                ["acquisitionDate", "Acquired"],
                ["lastModifiedDate", "Modified"],
                ["title", "Title"],
                ["developer", "Developer"],
              ]}
            />
            <FilterSelect
              label="Order"
              value={sortOrder}
              onValueChange={(value) => setSortOrder(value as "asc" | "desc")}
              options={[
                ["desc", "Descending"],
                ["asc", "Ascending"],
              ]}
            />
            <div className="flex gap-2">
              <Button
                variant={view === "table" ? "default" : "outline"}
                size="icon"
                onClick={() => setView("table")}
                title="Table view"
              >
                <List />
              </Button>
              <Button
                variant={view === "grid" ? "default" : "outline"}
                size="icon"
                onClick={() => setView("grid")}
                title="Grid view"
              >
                <Grid2X2 />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() =>
                  setSortOrder((current) => (current === "asc" ? "desc" : "asc"))
                }
                title="Flip sort"
              >
                <ArrowDownAZ />
              </Button>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <FilterSelect
              label="Type"
              value={filters.itemType ?? "all"}
              onValueChange={(value) => updateFilter("itemType", value)}
              options={toSelectOptions(filterOptions?.itemTypes)}
            />
            <FilterSelect
              label="Developer"
              value={filters.developer ?? "all"}
              onValueChange={(value) => updateFilter("developer", value)}
              options={toSelectOptions(filterOptions?.developers)}
            />
            <FilterSelect
              label="Namespace"
              value={filters.namespace ?? "all"}
              onValueChange={(value) => updateFilter("namespace", value)}
              options={toSelectOptions(filterOptions?.namespaces)}
            />
            <FilterSelect
              label="Category"
              value={filters.category ?? "all"}
              onValueChange={(value) => updateFilter("category", value)}
              options={toSelectOptions(filterOptions?.categories)}
            />
            <FilterSelect
              label="Platform"
              value={filters.platform ?? "all"}
              onValueChange={(value) => updateFilter("platform", value)}
              options={toSelectOptions(filterOptions?.platforms)}
            />
            <FilterSelect
              label="Status"
              value={filters.status ?? "all"}
              onValueChange={(value) => updateFilter("status", value)}
              options={toSelectOptions(filterOptions?.statuses)}
            />
            <BooleanFilter
              label="Unsearchable"
              value={filters.unsearchable ?? "all"}
              onValueChange={(value) => updateFilter("unsearchable", value)}
            />
            <BooleanFilter
              label="Store page"
              value={filters.storePage ?? "all"}
              onValueChange={(value) => updateFilter("storePage", value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b">
          <CardTitle>
            {pagination?.totalItems ?? 0} matching item
            {(pagination?.totalItems ?? 0) === 1 ? "" : "s"}
          </CardTitle>
          <CardDescription>
            Page {pagination?.currentPage ?? 1} of {pagination?.totalPages ?? 1}
          </CardDescription>
        </CardHeader>
        <CardContent className="py-4">
          {searchResultQuery.isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="animate-spin" />
              Loading library
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center">
              <p className="font-medium">No items match these filters</p>
              <p className="text-sm text-muted-foreground">
                Clear a filter or sync your Epic library.
              </p>
            </div>
          ) : view === "grid" ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {items.map((item) => (
                <LibraryGridCard
                  key={item.id}
                  item={item}
                  onSelect={() => setSelectedItem(item)}
                />
              ))}
            </div>
          ) : (
            <LibraryTable items={items} onSelect={setSelectedItem} />
          )}

          {pagination && pagination.totalPages > 1 && (
            <div className="mt-6 flex items-center justify-center gap-2">
              <Button
                variant="outline"
                onClick={() => setPage((current) => current - 1)}
                disabled={pagination.currentPage === 1}
              >
                <ChevronLeft />
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {pagination.currentPage} of {pagination.totalPages}
              </span>
              <Button
                variant="outline"
                onClick={() => setPage((current) => current + 1)}
                disabled={pagination.currentPage === pagination.totalPages}
              >
                Next
                <ChevronRight />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <LibraryDetailSheet
        item={selectedItem}
        open={Boolean(selectedItem)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedItem(null);
          }
        }}
      />
    </div>
  );
}

function LibraryGridCard({
  item,
  onSelect,
}: {
  item: LibraryItemRecord;
  onSelect: () => void;
}) {
  const cover = getBestImage(item.keyImages);
  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <button
          type="button"
          onClick={onSelect}
          className="group w-full overflow-hidden rounded-lg border border-border bg-secondary/20 text-left transition hover:border-primary/60"
        >
          {cover && (
            <img src={cover.url} alt={item.title} className="h-32 w-full object-cover" />
          )}
          <div className="space-y-2 p-3">
            <p className="line-clamp-2 font-medium">{item.title}</p>
            <p className="truncate text-xs text-muted-foreground">{item.developer}</p>
            <div className="flex gap-2 text-xs text-muted-foreground">
              <span>{item.itemType}</span>
              <span>{item.status}</span>
            </div>
          </div>
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => copyText(item.id)}>Copy ID</ContextMenuItem>
        <ContextMenuItem onClick={() => copyText(item.namespace)}>
          Copy namespace
        </ContextMenuItem>
        <ContextMenuItem onClick={onSelect}>View details</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function LibraryTable({
  items,
  onSelect,
}: {
  items: LibraryItemRecord[];
  onSelect: (item: LibraryItemRecord) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] text-sm">
        <thead className="border-b text-left text-muted-foreground">
          <tr>
            <th className="py-2 pr-3 font-medium">Title</th>
            <th className="py-2 pr-3 font-medium">Developer</th>
            <th className="py-2 pr-3 font-medium">Type</th>
            <th className="py-2 pr-3 font-medium">Status</th>
            <th className="py-2 pr-3 font-medium">Acquired</th>
            <th className="py-2 pr-3 font-medium">Flags</th>
            <th className="py-2 pr-3 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-b border-border/60">
              <td className="max-w-[280px] py-3 pr-3">
                <button
                  type="button"
                  className="truncate text-left font-medium hover:underline"
                  onClick={() => onSelect(item)}
                >
                  {item.title}
                </button>
                <p className="truncate text-xs text-muted-foreground">
                  {item.namespace}
                </p>
              </td>
              <td className="max-w-[180px] truncate py-3 pr-3">{item.developer}</td>
              <td className="py-3 pr-3">{item.itemType}</td>
              <td className="py-3 pr-3">{item.status}</td>
              <td className="py-3 pr-3">{formatDateTime(item.acquisitionDate)}</td>
              <td className="py-3 pr-3">
                <div className="flex flex-wrap gap-1">
                  {item.unsearchable && <Pill label="Hidden" />}
                  {item.endOfSupport && <Pill label="EOS" />}
                  {item.requiresSecureAccount && <Pill label="Secure" />}
                  {!itemHasStorePage(item) && <Pill label="No page" />}
                </div>
              </td>
              <td className="py-3 pr-3">
                <Button variant="ghost" size="sm" onClick={() => onSelect(item)}>
                  Details
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LibraryDetailSheet({
  item,
  open,
  onOpenChange,
}: {
  item: LibraryItemRecord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const offerQuery = useQuery({
    queryKey: ["item-base-offer", item?.id],
    queryFn: async () => {
      if (!item) {
        return null;
      }
      const response = await fetch(
        `https://api-gcp.egdata.app/items/${item.id}/offer`,
      );
      const json = (await response.json()) as Offer | { error: string };
      return "error" in json ? null : json;
    },
    enabled: Boolean(item),
  });
  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => messagingClient.getSettings(),
  });
  const watchMutation = useMutation({
    mutationFn: (offer: Offer) =>
      messagingClient.updateWatchlist({
        type: "upsert",
        item: {
          offerId: offer.id,
          namespace: offer.namespace,
          title: offer.title,
          country: settingsQuery.data?.country ?? "US",
          targetPrice: null,
          currentPrice: null,
          lastSeenPrice: null,
          lastNotifiedPrice: null,
          imageUrl: getBestImage(offer.keyImages, true)?.url ?? null,
          storeUrl: getOfferStoreUrl(offer),
          egdataUrl: getEgdataOfferUrl(offer.id),
        },
      }),
    onSuccess: async () => {
      toast.success("Added to watchlist");
      await queryClient.invalidateQueries({ queryKey: ["watchlist"] });
    },
  });

  const offer = offerQuery.data;
  const storeUrl = offer ? getOfferStoreUrl(offer) : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {item && (
          <>
            <SheetHeader>
              <SheetTitle>{item.title}</SheetTitle>
              <SheetDescription>{item.developer}</SheetDescription>
            </SheetHeader>
            <div className="space-y-5 px-4 pb-6">
              {getBestImage(item.keyImages) && (
                <img
                  src={getBestImage(item.keyImages)?.url}
                  alt={item.title}
                  className="h-48 w-full rounded-lg object-cover"
                />
              )}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <Detail label="Item ID" value={item.id} copy />
                <Detail label="Namespace" value={item.namespace} copy />
                <Detail label="Type" value={item.itemType} />
                <Detail label="Status" value={item.status} />
                <Detail label="Acquired" value={formatDateTime(item.acquisitionDate)} />
                <Detail label="Modified" value={formatDateTime(item.lastModifiedDate)} />
              </div>
              <div>
                <p className="mb-2 text-sm font-medium">Categories</p>
                <p className="text-sm text-muted-foreground">{getItemCategoryText(item)}</p>
              </div>
              <div>
                <p className="mb-2 text-sm font-medium">Platforms</p>
                <p className="text-sm text-muted-foreground">
                  {item.releaseInfo.flatMap((release) => release.platform).join(", ") ||
                    "Unknown"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {storeUrl && (
                  <Button asChild>
                    <a href={storeUrl} target="_blank" rel="noreferrer">
                      <ExternalLink />
                      Epic Store
                    </a>
                  </Button>
                )}
                {offer && (
                  <>
                    <Button asChild variant="outline">
                      <a
                        href={getEgdataOfferUrl(offer.id)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <ExternalLink />
                        egdata
                      </a>
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => watchMutation.mutate(offer)}
                      disabled={watchMutation.isPending}
                    >
                      <Star />
                      Watch offer
                    </Button>
                  </>
                )}
                <Button variant="outline" onClick={() => copyText(item.id)}>
                  <Copy />
                  Copy ID
                </Button>
              </div>
              {offerQuery.isLoading && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="animate-spin" />
                  Loading related offer
                </div>
              )}
              {!offerQuery.isLoading && !offer && (
                <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                  No related store offer was found for this item.
                </div>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Detail({
  label,
  value,
  copy,
}: {
  label: string;
  value: string;
  copy?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border/70 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <button
        type="button"
        className="max-w-full truncate font-mono text-xs"
        onClick={() => copy && copyText(value)}
      >
        {value}
      </button>
    </div>
  );
}

function Pill({ label }: { label: string }) {
  return (
    <span className="rounded bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
      {label}
    </span>
  );
}

function FilterSelect({
  label,
  value,
  onValueChange,
  options,
}: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  options: Array<[string, string]>;
}) {
  return (
    <Select value={value || "all"} onValueChange={onValueChange}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{label}: All</SelectItem>
        {options.map(([optionValue, optionLabel]) => (
          <SelectItem key={optionValue} value={optionValue}>
            {optionLabel}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function BooleanFilter({
  label,
  value,
  onValueChange,
}: {
  label: string;
  value: "all" | "yes" | "no";
  onValueChange: (value: "all" | "yes" | "no") => void;
}) {
  return (
    <FilterSelect
      label={label}
      value={value}
      onValueChange={(next) => onValueChange(next as "all" | "yes" | "no")}
      options={[
        ["yes", "Yes"],
        ["no", "No"],
      ]}
    />
  );
}

function toSelectOptions(values: string[] = []): Array<[string, string]> {
  return values.slice(0, 200).map((value) => [value, value]);
}

function copyText(value: string) {
  navigator.clipboard.writeText(value);
  toast.success("Copied");
}
