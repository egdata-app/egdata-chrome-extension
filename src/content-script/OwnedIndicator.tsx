import { cn } from "@/lib/utils";
import type { OwnershipStatus } from "@/types/egdata";
import { Check, GitCompareArrows, Lock, ShieldAlert } from "lucide-react";
import { useState } from "react";

const STATUS_META: Record<
  OwnershipStatus,
  { label: string; className: string; Icon: typeof Check }
> = {
  owned: {
    label: "Owned",
    className: "bg-emerald-600",
    Icon: Check,
  },
  "partial-upgrade": {
    label: "Upgrade",
    className: "bg-blue-600",
    Icon: GitCompareArrows,
  },
  duplicate: {
    label: "Duplicate",
    className: "bg-amber-600",
    Icon: ShieldAlert,
  },
  "missing-prerequisite": {
    label: "Needs base",
    className: "bg-rose-600",
    Icon: Lock,
  },
  "not-owned": {
    label: "Not owned",
    className: "bg-neutral-700",
    Icon: ShieldAlert,
  },
  unknown: {
    label: "Unknown",
    className: "bg-neutral-700",
    Icon: ShieldAlert,
  },
};

export function OwnedIndicator({
  status = "owned",
}: {
  status?: OwnershipStatus;
}) {
  const [hovered, setHovered] = useState(false);
  const meta = STATUS_META[status] ?? STATUS_META.unknown;
  const Icon = meta.Icon;

  return (
    <div
      className={cn(
        "absolute top-2.5 left-2.5 z-10 flex h-7 items-center rounded text-white shadow transition-all duration-200",
        hovered ? "w-28" : "w-7",
        meta.className,
      )}
      style={{
        fontFamily: "sans-serif",
        pointerEvents: "none",
      }}
    >
      <div
        className="flex h-7 w-7 shrink-0 items-center justify-center"
        style={{ pointerEvents: "auto" }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <Icon className="h-4 w-4" />
      </div>
      {hovered && (
        <span
          className="ml-0.5 truncate pr-2 text-xs font-semibold"
          style={{ pointerEvents: "auto" }}
        >
          {meta.label}
        </span>
      )}
    </div>
  );
}
