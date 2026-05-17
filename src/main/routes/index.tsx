import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { messagingClient } from '@/lib/clients/messaging';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Library,
  RefreshCw,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

export const Route = createFileRoute('/')({
  component: RouteComponent,
});

function formatDate(value?: number) {
  if (!value) {
    return 'Never';
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function RouteComponent() {
  const [isManualSyncing, setIsManualSyncing] = useState(false);
  const authQuery = useQuery({
    queryKey: ['auth-status'],
    queryFn: () => messagingClient.getAuthStatus(),
  });
  const libraryStatusQuery = useQuery({
    queryKey: ['library-status'],
    queryFn: () => messagingClient.getLibraryStatus(),
  });
  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: () => messagingClient.getSettings(),
  });

  const authStatus = authQuery.data;
  const libraryStatus = libraryStatusQuery.data;
  const settings = settingsQuery.data;
  const isSyncing = isManualSyncing || libraryStatus?.state === 'syncing';

  const handleSync = async () => {
    setIsManualSyncing(true);
    try {
      await messagingClient.syncLibrary();
      await libraryStatusQuery.refetch();
      toast.success('Library sync completed');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Sync failed');
      await libraryStatusQuery.refetch();
    } finally {
      setIsManualSyncing(false);
    }
  };

  const handleOpenLogin = async () => {
    try {
      await messagingClient.openEpicLogin();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Unable to open Epic Games',
      );
    }
  };

  const handleBadgesToggle = async (checked: boolean) => {
    try {
      await messagingClient.updateSettings({ showOwnedBadges: checked });
      await settingsQuery.refetch();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Unable to update settings',
      );
    }
  };

  return (
    <div className="container mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">egdata.app</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Epic Games library status
          </p>
        </div>
        <div className="flex gap-2">
          {!authStatus?.isAuthenticated && (
            <Button onClick={handleOpenLogin}>Connect Epic Games</Button>
          )}
          <Button
            className="gap-2"
            disabled={!authStatus?.isAuthenticated || isSyncing}
            onClick={handleSync}
            variant="outline"
          >
            <RefreshCw
              className={`h-4 w-4 ${isSyncing ? 'animate-spin' : ''}`}
            />
            {isSyncing ? 'Syncing' : 'Sync Library'}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-3 p-5">
            {authStatus?.isAuthenticated ? (
              <CheckCircle2 className="h-6 w-6 text-emerald-500" />
            ) : (
              <AlertCircle className="h-6 w-6 text-amber-500" />
            )}
            <div>
              <div className="text-sm text-muted-foreground">Epic Account</div>
              <div className="font-semibold">
                {authQuery.isLoading
                  ? 'Checking'
                  : authStatus?.isAuthenticated
                    ? 'Connected'
                    : 'Disconnected'}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-3 p-5">
            <Library className="h-6 w-6 text-blue-500" />
            <div>
              <div className="text-sm text-muted-foreground">Library Items</div>
              <div className="font-semibold">
                {libraryStatusQuery.isLoading
                  ? 'Loading'
                  : (libraryStatus?.itemCount ?? 0).toLocaleString()}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-3 p-5">
            <Clock className="h-6 w-6 text-violet-500" />
            <div>
              <div className="text-sm text-muted-foreground">Last Sync</div>
              <div className="font-semibold">
                {formatDate(libraryStatus?.lastSyncedAt)}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {libraryStatus?.lastError && (
        <div className="rounded border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {libraryStatus.lastError}
        </div>
      )}

      <Card>
        <CardContent className="flex items-center justify-between gap-4 p-5">
          <div>
            <div className="font-semibold">
              Owned badges on Epic Games Store
            </div>
            <div className="text-sm text-muted-foreground">
              {settings?.showOwnedBadges ? 'Enabled' : 'Disabled'}
            </div>
          </div>
          <input
            checked={settings?.showOwnedBadges ?? true}
            className="h-5 w-5 accent-blue-600"
            onChange={(event) =>
              handleBadgesToggle(event.currentTarget.checked)
            }
            type="checkbox"
          />
        </CardContent>
      </Card>
    </div>
  );
}
