import { cn } from '@/lib/utils';
import { CheckCircle2 } from 'lucide-react';

export function OwnedIndicator() {
  return (
    <div
      aria-label="Owned in your Epic Games library"
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded bg-blue-600 px-2 text-xs font-semibold text-white shadow',
      )}
    >
      <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5" />
      <span>Owned</span>
    </div>
  );
}
