import { cn } from "@/lib/utils";
import React, { useState } from "react";

export function OwnedIndicator() {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className={cn(
        "absolute top-2.5 left-2.5 z-10 flex items-center transition-all duration-200",
        "h-7 rounded text-white shadow",
        hovered ? "w-20 bg-blue-600" : "w-7 bg-blue-500"
      )}
      style={{
        fontFamily: "sans-serif",
        pointerEvents: "none",
      }}
    >
      {/* Icon and text area - allow pointer events for hover */}
      <div
        className="flex flex-col items-center justify-center w-7 h-7 shrink-0"
        style={{ pointerEvents: "auto" }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <div className="w-3 h-0.5 bg-white mb-0.5 rounded" />
        <div className="w-3 h-0.5 bg-white mb-0.5 rounded" />
        <div className="w-3 h-0.5 bg-white rounded" />
      </div>

      {/* Text - only visible on hover */}
      {hovered && (
        <span
          className="ml-0.5 text-xs font-semibold whitespace-nowrap"
          style={{ pointerEvents: "auto" }}
        >
          Owned
        </span>
      )}
    </div>
  );
}
