import type { EgdataOffer, EgdataPriceValue } from "@/types/egdata";
import type { Item } from "@/types/item";
import type { KeyImage } from "@/types/key-images";
import type { Offer } from "@/types/offer";

const IMAGE_PRIORITY = [
  "OfferImageWide",
  "DieselStoreFrontWide",
  "DieselGameBoxTall",
  "OfferImageTall",
  "Thumbnail",
  "VaultClosed",
  "VaultOpen",
];

export function getBestImage(images: KeyImage[] = [], preferTall = false) {
  const priority = preferTall
    ? ["OfferImageTall", "DieselGameBoxTall", ...IMAGE_PRIORITY]
    : IMAGE_PRIORITY;

  return (
    priority
      .map((type) => images.find((image) => image.type === type))
      .find(Boolean) ?? images[0]
  );
}

export function formatPrice(price?: EgdataPriceValue | null) {
  if (!price) {
    return "Unknown";
  }

  if (price.discountPrice === 0) {
    return "Free";
  }

  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: price.currencyCode || "USD",
  }).format(price.discountPrice / 100);
}

export function formatDiscount(price?: EgdataPriceValue | null) {
  if (!price || price.originalPrice <= price.discountPrice) {
    return null;
  }

  return `-${Math.round((price.discount / price.originalPrice) * 100)}%`;
}

export function formatDateTime(value?: string | null) {
  if (!value) {
    return "Never";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function daysUntil(value?: string | null) {
  if (!value) {
    return null;
  }

  const diff = new Date(value).getTime() - Date.now();
  if (!Number.isFinite(diff)) {
    return null;
  }

  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export function normalizeOfferKey(namespace: string, offerId: string) {
  return `${namespace}:${offerId}`;
}

export function getOfferStoreUrl(offer: Pick<EgdataOffer, "id" | "namespace" | "offerType" | "productSlug" | "urlSlug" | "customAttributes"> & {
  offerMappings?: Offer["offerMappings"];
}) {
  const isBundle = offer.offerType === "BUNDLE";
  const namespace = isBundle ? "bundles" : "product";
  const slug =
    offer.customAttributes?.["com.epicgames.app.productSlug"]?.value ??
    offer.offerMappings?.[0]?.pageSlug ??
    offer.productSlug ??
    offer.urlSlug;

  if (!slug) {
    return null;
  }

  return `https://store.epicgames.com/${namespace}/${slug.replaceAll(
    "-pp",
    "",
  )}`;
}

export function getEgdataOfferUrl(offerId: string) {
  return `https://egdata.app/offers/${offerId}`;
}

export function itemHasStorePage(item: Item) {
  return Boolean(
    item.customAttributes?.["com.epicgames.app.productSlug"]?.value ??
      item.customAttributes?.["com.epicgames.app.urlSlug"]?.value,
  );
}

export function getItemCategoryText(item: Item) {
  return item.categories?.map((category) => category.path).join(", ") || "None";
}

export function downloadTextFile(
  filename: string,
  content: string,
  type = "text/plain",
) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function toCsv<T extends Record<string, unknown>>(
  rows: T[],
  columns: Array<{ key: keyof T; label: string }>,
) {
  const escapeCsvValue = (value: unknown) => {
    const text = value == null ? "" : String(value);
    return `"${text.replaceAll('"', '""')}"`;
  };

  return [
    columns.map((column) => escapeCsvValue(column.label)).join(","),
    ...rows.map((row) =>
      columns.map((column) => escapeCsvValue(row[column.key])).join(","),
    ),
  ].join("\n");
}
