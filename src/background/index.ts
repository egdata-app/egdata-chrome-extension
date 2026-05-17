import { EpicGamesGraphQLClient } from '@/lib/clients/epic';
import { decodeJWT } from '@/lib/jwt';
import {
  type ApiResponse,
  type ExternalMessage,
  type InternalMessage,
  type LegacyOfferLookupInput,
  type OfferLookupInput,
  isExternalMessage,
  isInternalMessage,
  responseError,
  responseOk,
} from '@/lib/messages';
import { librarySyncService } from '@/lib/services/library-sync';
import { ownershipCacheService } from '@/lib/services/ownership-cache';
import { pricingService } from '@/lib/services/pricing';
import { getSettings, updateSettings } from '@/lib/services/settings';
import type { LibraryResponse } from '@/types/get-library';
import consola from 'consola';

const logger = consola.withTag('background');
const SYNC_ALARM_NAME = 'library-sync';
const SYNC_INTERVAL_MINUTES = 30;
const EPIC_STORE_URL = 'https://store.epicgames.com';
const ALLOWED_EXTERNAL_HOST_SUFFIX = '.egdata.app';
const ALLOWED_EXTERNAL_HOST = 'egdata.app';

let epicClient: EpicGamesGraphQLClient | null = null;
let epicClientToken: string | null = null;

async function getEpicToken(): Promise<string> {
  const authCookie = await chrome.cookies.get({
    name: 'EPIC_EG1',
    url: EPIC_STORE_URL,
  });

  if (!authCookie?.value) {
    throw new Error('Epic Games authentication cookie not found');
  }

  return authCookie.value;
}

async function getAuthStatus() {
  const authCookie = await chrome.cookies.get({
    name: 'EPIC_EG1',
    url: EPIC_STORE_URL,
  });

  if (!authCookie?.value) {
    return { isAuthenticated: false };
  }

  try {
    const payload = decodeJWT(authCookie.value);
    const expiresAt =
      typeof payload.exp === 'number' ? payload.exp * 1000 : undefined;
    return {
      isAuthenticated: !expiresAt || expiresAt > Date.now(),
      expiresAt,
    };
  } catch {
    return { isAuthenticated: true };
  }
}

async function getEpicClient(): Promise<EpicGamesGraphQLClient> {
  const token = await getEpicToken();

  if (!epicClient || epicClientToken !== token) {
    epicClient = new EpicGamesGraphQLClient({ token });
    epicClientToken = token;
  }

  return epicClient;
}

function resetEpicClients() {
  epicClient = null;
  epicClientToken = null;
  librarySyncService.resetEpicClient();
  ownershipCacheService.resetEpicClient();
}

async function fetchLibraryData(): Promise<LibraryResponse> {
  const client = await getEpicClient();
  const token = await getEpicToken();

  return client.getLibrary({
    token,
    includeMetadata: true,
    excludeNs: ['ue'],
  });
}

async function runLibrarySync() {
  const startedAt = Date.now();

  try {
    const library = await fetchLibraryData();
    return librarySyncService.syncLibrary(library);
  } catch (error) {
    await librarySyncService.recordSyncFailure(error, startedAt);
    throw error;
  }
}

function ensureLibrarySyncAlarm() {
  chrome.alarms.create(SYNC_ALARM_NAME, {
    periodInMinutes: SYNC_INTERVAL_MINUTES,
  });
}

async function handleInternalMessage(
  message: InternalMessage,
): Promise<ApiResponse<unknown>> {
  switch (message.action) {
    case 'auth.getStatus':
      return responseOk(await getAuthStatus());

    case 'auth.openLogin': {
      const tab = await chrome.tabs.create({
        url: EPIC_STORE_URL,
        active: true,
      });
      return responseOk({ tabId: tab.id });
    }

    case 'library.getStatus':
      return responseOk(await librarySyncService.getSyncStatus());

    case 'library.sync':
      return responseOk(await runLibrarySync());

    case 'library.search':
      return responseOk(await librarySyncService.searchItems(message.payload));

    case 'ownership.checkSlugs':
      return responseOk(
        await ownershipCacheService.checkSlugs(message.payload?.slugs),
      );

    case 'ownership.checkOffers':
      return responseOk(
        await ownershipCacheService.checkOffers(message.payload?.offers),
      );

    case 'pricing.getOfferHistory':
      return responseOk(await pricingService.getOfferHistory(message.payload));

    case 'settings.get':
      return responseOk(await getSettings());

    case 'settings.update':
      return responseOk(await updateSettings(message.payload));
  }
}

function getSenderOrigin(sender: chrome.runtime.MessageSender): URL | null {
  const rawOrigin = sender.origin ?? sender.url;
  if (!rawOrigin) {
    return null;
  }

  try {
    return new URL(rawOrigin);
  } catch {
    return null;
  }
}

function isAllowedExternalSender(
  sender: chrome.runtime.MessageSender,
): boolean {
  const origin = getSenderOrigin(sender);
  if (!origin) {
    return false;
  }

  const isEgdataOrigin =
    origin.protocol === 'https:' &&
    (origin.hostname === ALLOWED_EXTERNAL_HOST ||
      origin.hostname.endsWith(ALLOWED_EXTERNAL_HOST_SUFFIX));

  if (isEgdataOrigin) {
    return true;
  }

  const manifestMatches =
    chrome.runtime.getManifest().externally_connectable?.matches ?? [];
  const devAllowsLocalhost = manifestMatches.some((match) =>
    match.includes('localhost'),
  );

  return devAllowsLocalhost && origin.hostname === 'localhost';
}

function toLegacyOwnedOffers(
  requestedOffers: LegacyOfferLookupInput[],
  ownedOffers: OfferLookupInput[],
): LegacyOfferLookupInput[] {
  const ownedKeys = new Set(
    ownedOffers.map((offer) => `${offer.namespace}:${offer.offerId}`),
  );

  return requestedOffers.filter((offer) =>
    ownedKeys.has(`${offer.namespace}:${offer.id}`),
  );
}

async function handleExternalMessage(
  message: ExternalMessage,
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  if (!isAllowedExternalSender(sender)) {
    return { error: 'Sender is not allowed to connect to this extension' };
  }

  switch (message.action) {
    case 'ownership.checkSlugs':
      return responseOk(
        await ownershipCacheService.checkSlugs(message.payload?.slugs),
      );

    case 'ownership.checkOffers':
      return responseOk(
        await ownershipCacheService.checkOffers(message.payload?.offers),
      );

    case 'getOwnedSlugs':
      return ownershipCacheService.checkSlugs(message.payload?.slugs);

    case 'getOwnedOffers': {
      const requestedOffers = message.payload?.offers ?? [];
      const result = await ownershipCacheService.checkOffers(requestedOffers);
      return {
        ownedOffers: toLegacyOwnedOffers(requestedOffers, result.ownedOffers),
      };
    }
  }
}

chrome.runtime.onStartup.addListener(() => {
  logger.info('Extension started');
  ensureLibrarySyncAlarm();
  runLibrarySync().catch((error) => {
    logger.warn('Startup library sync skipped or failed:', error);
  });
});

chrome.runtime.onInstalled.addListener(async () => {
  logger.info('Extension installed or updated');
  await updateSettings({});
  ensureLibrarySyncAlarm();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== SYNC_ALARM_NAME) {
    return;
  }

  runLibrarySync().catch((error) => {
    logger.error('Scheduled library sync failed:', error);
  });
});

chrome.cookies.onChanged.addListener((changeInfo) => {
  if (changeInfo.cookie.name === 'EPIC_EG1') {
    resetEpicClients();
  }
});

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: `${chrome.runtime.getURL('main.html')}#/` });
});

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (!isInternalMessage(request)) {
    sendResponse(responseError('Unsupported internal message action'));
    return false;
  }

  handleInternalMessage(request)
    .then(sendResponse)
    .catch((error) => sendResponse(responseError(error)));

  return true;
});

chrome.runtime.onMessageExternal.addListener(
  (request, sender, sendResponse) => {
    if (!isExternalMessage(request)) {
      sendResponse({ error: 'Unsupported external message action' });
      return false;
    }

    handleExternalMessage(request, sender)
      .then(sendResponse)
      .catch((error) =>
        sendResponse({
          error: error instanceof Error ? error.message : String(error),
        }),
      );

    return true;
  },
);
