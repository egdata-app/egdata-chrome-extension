import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { messagingClient } from '@/lib/clients/messaging';
import { formatDateTime } from '@/lib/offer-utils';
import type { AppSettings } from '@/types/egdata';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import {
  Bell,
  Database,
  Eye,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

export const Route = createFileRoute('/settings')({
  component: SettingsRoute,
});

function SettingsRoute() {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: () => messagingClient.getSettings(),
  });
  const healthQuery = useQuery({
    queryKey: ['health'],
    queryFn: () => messagingClient.getHealth(),
  });
  const [country, setCountry] = useState('US');

  useEffect(() => {
    if (settingsQuery.data?.country) {
      setCountry(settingsQuery.data.country);
    }
  }, [settingsQuery.data?.country]);

  const updateMutation = useMutation({
    mutationFn: (patch: Partial<AppSettings>) =>
      messagingClient.updateSettings(patch),
    onSuccess: async () => {
      toast.success('Settings saved');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['settings'] }),
        queryClient.invalidateQueries({ queryKey: ['health'] }),
        queryClient.invalidateQueries({ queryKey: ['free-games'] }),
      ]);
    },
  });
  const syncMutation = useMutation({
    mutationFn: () => messagingClient.syncLibrary(),
    onSuccess: async () => {
      toast.success('Library sync completed');
      await queryClient.invalidateQueries({ queryKey: ['health'] });
    },
  });
  const checkMutation = useMutation({
    mutationFn: () => messagingClient.checkWatchlist(),
    onSuccess: (result) => toast.success(result.summary),
  });
  const clearCacheMutation = useMutation({
    mutationFn: () => messagingClient.clearOfferCache(),
    onSuccess: async () => {
      toast.success('Offer cache cleared');
      await queryClient.invalidateQueries({ queryKey: ['health'] });
    },
  });

  const settings = settingsQuery.data;
  const health = healthQuery.data;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 overflow-y-auto px-2 pb-10 pt-2">
      <section>
        <p className="text-sm text-muted-foreground">
          Account, overlay, alerts, cache
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck />
              Account
            </CardTitle>
            <CardDescription>
              Epic authentication and library sync state.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <SettingLine
              label="Epic login"
              value={health?.isAuthenticated ? 'Connected' : 'Missing'}
            />
            <SettingLine
              label="Owned items"
              value={String(health?.ownedItemCount ?? 0)}
            />
            <SettingLine
              label="Last sync"
              value={formatDateTime(health?.lastSyncAt)}
            />
            <SettingLine
              label="Sync status"
              value={health?.lastSyncStatus ?? 'idle'}
            />
            {health?.lastSyncError && (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                {health.lastSyncError}
              </p>
            )}
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
              Sync now
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Eye />
              Store Overlay
            </CardTitle>
            <CardDescription>
              Controls injected UI on store.epicgames.com.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ToggleLine
              label="Owned and duplicate indicators"
              value={Boolean(settings?.overlayEnabled)}
              onToggle={(value) =>
                updateMutation.mutate({ overlayEnabled: value })
              }
            />
            <Separator />
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="country">
                Store country
              </label>
              <div className="flex gap-2">
                <Input
                  id="country"
                  value={country}
                  onChange={(event) =>
                    setCountry(event.target.value.toUpperCase().slice(0, 2))
                  }
                  className="w-24"
                />
                <Button
                  variant="outline"
                  onClick={() =>
                    updateMutation.mutate({ country: country || 'US' })
                  }
                >
                  Save
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Used for egdata prices, free-game data, and watchlist checks.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell />
              Alerts
            </CardTitle>
            <CardDescription>
              OS notifications are opt-in. Dashboard reminders still appear
              in-app.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ToggleLine
              label="Enable OS notifications"
              value={Boolean(settings?.notificationsEnabled)}
              onToggle={(value) =>
                updateMutation.mutate({ notificationsEnabled: value })
              }
            />
            <ToggleLine
              label="Watched deal alerts"
              value={Boolean(settings?.dealAlertsEnabled)}
              onToggle={(value) =>
                updateMutation.mutate({ dealAlertsEnabled: value })
              }
            />
            <ToggleLine
              label="Free-game expiry reminders"
              value={Boolean(settings?.freeGameRemindersEnabled)}
              onToggle={(value) =>
                updateMutation.mutate({ freeGameRemindersEnabled: value })
              }
            />
            <Button
              variant="outline"
              onClick={() => checkMutation.mutate()}
              disabled={checkMutation.isPending}
            >
              {checkMutation.isPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <RefreshCw />
              )}
              Check watched deals
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database />
              Local Data
            </CardTitle>
            <CardDescription>
              Local browser storage used by this extension.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <SettingLine
              label="Watchlist items"
              value={String(health?.watchlistCount ?? 0)}
            />
            <SettingLine
              label="Offer cache entries"
              value={String(health?.cache.offerCacheCount ?? 0)}
            />
            <SettingLine
              label="Notifications"
              value={health?.notificationsEnabled ? 'Enabled' : 'Disabled'}
            />
            <Button
              variant="outline"
              onClick={() => clearCacheMutation.mutate()}
              disabled={clearCacheMutation.isPending}
            >
              {clearCacheMutation.isPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Database />
              )}
              Clear offer cache
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SettingLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-md bg-secondary/30 px-3 py-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function ToggleLine({
  label,
  value,
  onToggle,
}: {
  label: string;
  value: boolean;
  onToggle: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md bg-secondary/30 px-3 py-2">
      <span className="text-sm">{label}</span>
      <Button
        variant={value ? 'default' : 'outline'}
        size="sm"
        onClick={() => onToggle(!value)}
      >
        {value ? 'On' : 'Off'}
      </Button>
    </div>
  );
}
