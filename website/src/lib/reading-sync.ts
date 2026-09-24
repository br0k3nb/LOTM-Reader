import { browser } from "$app/environment";
import { get, writable } from "svelte/store";
import { authState, refreshAuth, startAuth } from "$lib/auth.svelte";
import type {
  PageReadEvent,
  ReadingProgress,
  ReadingStateResponse,
} from "$lib/reading-types";

export const LAST_READ_KEY = "lastRead";
const PROGRESS_OWNER_KEY = "readerProgressOwner";
const PROGRESS_PREFIX = "readerProgress:";
const QUEUE_PREFIX = "readerPageQueue:";
const FLOOR_PREFIX = "readerPageFloor:";
const LOGICAL_PAGE_HEIGHT = 800;
const MAX_PENDING_EVENTS = 5_000;
const SYNC_DEBOUNCE_MS = 1_200;

export type ReadingSyncState = {
  todayPages: number;
  daily: Record<string, number>;
  todayPending: number;
  syncing: boolean;
  online: boolean;
  lastSyncedAt: number | null;
  error: string | null;
};

export const readingSyncState = writable<ReadingSyncState>({
  todayPages: 0,
  daily: {},
  todayPending: 0,
  syncing: false,
  online: true,
  lastSyncedAt: null,
  error: null,
});

type QueueEvent = PageReadEvent;
type ProgressWithMeta = ReadingProgress;

let started = false;
let currentUserId: string | null = null;
let unsubscribeAuth: (() => void) | null = null;
let remoteProgress = new Map<string, ReadingProgress>();
let remoteDaily: Record<string, number> = {};
let initialSync: Promise<void> | null = null;
let syncInFlight: Promise<void> | null = null;
let continueAfterSync = false;
let queuedProgress: ReadingProgress | undefined;
let latestProgress: ReadingProgress | undefined;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;

function todayKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function validDateString(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function progressKey(book: string, tl: string): string {
  return `${book}\u0000${tl}`;
}

function eventKey(event: QueueEvent): string {
  return [
    event.book,
    event.tl,
    event.slug,
    event.pageIndex,
    event.date,
  ].join("\u0000");
}

function progressStorageKey(userId: string): string {
  return `${PROGRESS_PREFIX}${userId}`;
}

function queueStorageKey(userId: string): string {
  return `${QUEUE_PREFIX}${userId}`;
}

function floorStorageKey(
  userId: string,
  book: string,
  tl: string,
  slug: number,
  date: string,
): string {
  return `${FLOOR_PREFIX}${userId}\u0000${book}\u0000${tl}\u0000${slug}\u0000${date}`;
}

function parseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function validProgress(value: unknown): value is ProgressWithMeta {
  if (!value || typeof value !== "object") return false;
  const input = value as Record<string, unknown>;
  return (
    typeof input.book === "string" &&
    typeof input.tl === "string" &&
    Number.isSafeInteger(input.slug) &&
    Number(input.slug) >= 0 &&
    Number.isFinite(input.scroll) &&
    Number(input.scroll) >= 0 &&
    Number.isFinite(input.scrollRatio) &&
    Number(input.scrollRatio) >= 0 &&
    Number(input.scrollRatio) <= 1 &&
    Number.isSafeInteger(input.pageIndex) &&
    Number(input.pageIndex) >= 0 &&
    Number.isSafeInteger(input.updatedAt) &&
    Number(input.updatedAt) >= 0
  );
}

function normalizeProgress(value: unknown): ProgressWithMeta | null {
  if (!validProgress(value)) return null;
  return {
    book: value.book,
    tl: value.tl,
    slug: Number(value.slug),
    scroll: Math.round(Number(value.scroll)),
    scrollRatio: Math.max(0, Math.min(1, Number(value.scrollRatio))),
    pageIndex: Number(value.pageIndex),
    updatedAt: Number(value.updatedAt),
  };
}

function readSharedProgress(): ProgressWithMeta | null {
  const raw = parseJson<Record<string, unknown>>(localStorage.getItem(LAST_READ_KEY));
  const normalized = normalizeProgress(raw);
  if (normalized) return normalized;

  // Migrate the pre-sync localStorage shape on first read. Older versions
  // stored `timestamp` and an absolute scroll offset but no ratio/page fields.
  if (!raw || typeof raw !== "object") return null;
  const book = typeof raw.book === "string" ? raw.book : null;
  const tl = typeof raw.tl === "string" ? raw.tl : null;
  const slug = Number(raw.slug);
  const scroll = Number(raw.scroll);
  const updatedAt = Number(raw.timestamp);
  if (
    !book ||
    !tl ||
    !Number.isSafeInteger(slug) ||
    slug < 0 ||
    !Number.isFinite(scroll) ||
    scroll < 0 ||
    !Number.isSafeInteger(updatedAt) ||
    updatedAt < 0
  ) {
    return null;
  }
  return {
    book,
    tl,
    slug,
    scroll: Math.round(scroll),
    scrollRatio: 0,
    pageIndex: Math.floor(scroll / LOGICAL_PAGE_HEIGHT),
    updatedAt,
  };
}

function localProgressUserKey(): string {
  return currentUserId || "anonymous";
}

function readProgressForUser(userId: string): ProgressWithMeta | null {
  const namespaced = normalizeProgress(
    parseJson(localStorage.getItem(progressStorageKey(userId))),
  );
  if (namespaced) return namespaced;

  const owner = localStorage.getItem(PROGRESS_OWNER_KEY);
  // A shared lastRead value is guest data only when it has no owner. This keeps
  // a later account from accidentally uploading another account's position.
  if (owner && owner !== userId) return null;
  return readSharedProgress();
}

function writeLocalProgress(progress: ProgressWithMeta, userId: string | null): void {
  // Keep the historical shape so the existing Continue Reading UI and old
  // browsers continue to work, while adding fields used by cloud sync.
  localStorage.setItem(
    LAST_READ_KEY,
    JSON.stringify({
      book: progress.book,
      tl: progress.tl,
      slug: progress.slug,
      scroll: progress.scroll,
      scrollRatio: progress.scrollRatio,
      pageIndex: progress.pageIndex,
      timestamp: progress.updatedAt,
    }),
  );
  if (userId) {
    localStorage.setItem(progressStorageKey(userId), JSON.stringify(progress));
    localStorage.setItem(PROGRESS_OWNER_KEY, userId);
  } else {
    localStorage.removeItem(PROGRESS_OWNER_KEY);
  }
}

function readQueue(userId: string): QueueEvent[] {
  const value = parseJson<unknown>(localStorage.getItem(queueStorageKey(userId)));
  if (!Array.isArray(value)) return [];
  return value.filter((event): event is QueueEvent => {
    if (!event || typeof event !== "object") return false;
    const item = event as Record<string, unknown>;
    return (
      typeof item.book === "string" &&
      typeof item.tl === "string" &&
      Number.isSafeInteger(item.slug) &&
      Number(item.slug) >= 0 &&
      Number.isSafeInteger(item.pageIndex) &&
      Number(item.pageIndex) >= 0 &&
      validDateString(item.date)
    );
  });
}

function writeQueue(userId: string, events: QueueEvent[]): void {
  const unique = new Map<string, QueueEvent>();
  for (const event of events) unique.set(eventKey(event), event);
  const trimmed = [...unique.values()].slice(-MAX_PENDING_EVENTS);
  localStorage.setItem(queueStorageKey(userId), JSON.stringify(trimmed));
  readingSyncState.update((state) => ({
    ...state,
    todayPending: readQueueForToday(userId),
  }));
}

function readQueueForToday(userId: string): number {
  const date = todayKey();
  return new Set(readQueue(userId).filter((event) => event.date === date).map(eventKey)).size;
}

function addPageEvents(
  userId: string,
  events: QueueEvent[],
): void {
  if (events.length === 0) return;
  const current = readQueue(userId);
  const keys = new Set(current.map(eventKey));
  for (const event of events) {
    const key = eventKey(event);
    if (keys.has(key)) continue;
    keys.add(key);
    current.push(event);
  }
  writeQueue(userId, current);
}

function mergeAnonymousQueue(userId: string): void {
  const anonymous = readQueue("anonymous");
  if (anonymous.length === 0) return;
  const own = readQueue(userId);
  const merged = [...own];
  const keys = new Set(merged.map(eventKey));
  for (const event of anonymous) {
    if (!keys.has(eventKey(event))) merged.push(event);
  }
  writeQueue(userId, merged);
  localStorage.removeItem(queueStorageKey("anonymous"));
  readingSyncState.update((state) => ({ ...state, todayPending: readQueueForToday(userId) }));
}

function updatePendingState(userId: string | null): void {
  readingSyncState.update((state) => ({
    ...state,
    todayPending: userId ? readQueueForToday(userId) : 0,
  }));
}

function applyRemoteState(data: ReadingStateResponse): void {
  remoteProgress = new Map();
  for (const progress of data.progress) {
    remoteProgress.set(progressKey(progress.book, progress.tl), progress);
    const local = currentUserId ? readProgressForUser(currentUserId) : null;
    // Only replace the single shared Continue Reading value when it belongs to
    // this same book/translation, or when there is no local value yet. The
    // per-account cache still retains progress for every book.
    if (
      local &&
      (local.book !== progress.book || local.tl !== progress.tl || local.updatedAt >= progress.updatedAt)
    ) {
      continue;
    }
    writeLocalProgress(progress, currentUserId);
  }
  remoteDaily = data.daily || {};
  readingSyncState.update((state) => ({
    ...state,
    todayPages: Number(remoteDaily[todayKey()] || 0),
    daily: { ...remoteDaily },
    online: true,
    error: null,
  }));
}

async function fetchRemoteState(expectedUserId = currentUserId): Promise<ReadingStateResponse> {
  const response = await fetch("/api/reading/sync", {
    credentials: "same-origin",
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  if (response.status === 401) {
    await refreshAuth();
    throw new Error("not-authenticated");
  }
  const data = (await response.json().catch(() => null)) as
    | (ReadingStateResponse & { syncedAt?: number })
    | null;
  if (!response.ok || !data || !Array.isArray(data.progress) || !data.daily) {
    throw new Error("sync-failed");
  }
  if (expectedUserId && currentUserId !== expectedUserId) {
    throw new Error("account-changed");
  }
  applyRemoteState(data);
  return data;
}

async function sendSync(progress?: ReadingProgress): Promise<void> {
  if (!browser || !currentUserId) return;
  const userId = currentUserId;
  const queue = readQueue(userId);
  const events = queue.slice(0, 500);
  const selectedProgress = progress || readProgressForUser(userId);
  if (!selectedProgress && events.length === 0) return;

  readingSyncState.update((state) => ({ ...state, syncing: true, error: null }));
  try {
    const payload: { progress?: ReadingProgress; events: QueueEvent[] } = {
      events,
    };
    if (selectedProgress) payload.progress = selectedProgress;

    const response = await fetch("/api/reading/sync", {
      method: "POST",
      credentials: "same-origin",
      keepalive: true,
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(payload),
    });
    if (response.status === 401) {
      await refreshAuth();
      throw new Error("not-authenticated");
    }
    const data = (await response.json().catch(() => null)) as
      | (ReadingStateResponse & { syncedAt?: number })
      | null;
    if (!response.ok || !data) throw new Error("sync-failed");
    // The user may have signed out or switched accounts while the request was
    // in flight. Never apply the old account's response to the new session.
    if (currentUserId !== userId) {
      readingSyncState.update((state) => ({ ...state, syncing: false }));
      return;
    }

    const submitted = new Set(events.map(eventKey));
    const remaining = readQueue(userId).filter((event) => !submitted.has(eventKey(event)));
    writeQueue(userId, remaining);
    if (remaining.length > 0 && currentUserId === userId) {
      continueAfterSync = true;
    }
    applyRemoteState(data);
    readingSyncState.update((state) => ({
      ...state,
      syncing: false,
      online: true,
      lastSyncedAt: Number(data.syncedAt || Date.now()),
    }));
  } catch (error) {
    if (currentUserId !== userId) return;
    readingSyncState.update((state) => ({
      ...state,
      syncing: false,
      online: navigator.onLine,
      error: error instanceof Error && error.message === "not-authenticated" ? null : "Sync paused",
      lastSyncedAt: state.lastSyncedAt,
    }));
    if (error instanceof Error && error.message === "not-authenticated") {
      currentUserId = null;
    }
  }
}

function syncNow(progress?: ReadingProgress): Promise<void> {
  if (!browser || !currentUserId) return Promise.resolve();
  if (syncInFlight) {
    if (progress) queuedProgress = progress;
    return syncInFlight;
  }
  const operation = sendSync(progress).finally(() => {
    syncInFlight = null;
    if (continueAfterSync) {
      continueAfterSync = false;
      void syncNow();
    }
    if (queuedProgress) {
      const next = queuedProgress;
      queuedProgress = undefined;
      void syncNow(next);
    }
  });
  syncInFlight = operation;
  return operation;
}

function scheduleSync(progress: ReadingProgress): void {
  latestProgress = progress;
  if (!currentUserId) return;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = undefined;
    void syncNow(progress);
  }, SYNC_DEBOUNCE_MS);
}

/** Flush the latest local position when a tab is backgrounded or closed. */
export function flushReadingSync(): void {
  if (!browser || !currentUserId) return;
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = undefined;
  }
  if (latestProgress) void syncNow(latestProgress);
}

function queuePagesForProgress(
  userId: string,
  progress: Omit<ReadingProgress, "updatedAt"> & { updatedAt?: number },
): void {
  const date = todayKey();
  const floorKey = floorStorageKey(
    userId,
    progress.book,
    progress.tl,
    progress.slug,
    date,
  );
  const previous = Number(localStorage.getItem(floorKey) ?? -1);
  if (previous >= progress.pageIndex) return;

  // A reader can jump from the top to the bottom of a long chapter. Queue all
  // logical pages in that interval, but cap one burst so a malformed value
  // cannot block the UI.
  const last = Math.min(progress.pageIndex, previous + 5_000);
  const newEvents: QueueEvent[] = [];
  for (let pageIndex = Math.max(0, previous + 1); pageIndex <= last; pageIndex += 1) {
    newEvents.push({
      book: progress.book,
      tl: progress.tl,
      slug: progress.slug,
      pageIndex,
      date,
    });
  }
  addPageEvents(userId, newEvents);
  localStorage.setItem(floorKey, String(last));
  updatePendingState(userId);
}

/** Record a local scroll and schedule a debounced authenticated sync. */
export function recordReadingProgress(input: {
  book: string;
  tl: string;
  slug: number;
  scroll: number;
  documentHeight: number;
  viewportHeight: number;
}): ReadingProgress {
  const scroll = Math.max(0, Math.round(input.scroll));
  const maxScroll = Math.max(0, input.documentHeight - input.viewportHeight);
  const scrollRatio = maxScroll > 0 ? Math.max(0, Math.min(1, scroll / maxScroll)) : 0;
  const progress: ReadingProgress = {
    book: input.book,
    tl: input.tl,
    slug: input.slug,
    scroll,
    scrollRatio,
    pageIndex: Math.floor(scroll / LOGICAL_PAGE_HEIGHT),
    updatedAt: Date.now(),
  };

  if (browser) {
    try {
      const userId = currentUserId || "anonymous";
      queuePagesForProgress(userId, progress);
      writeLocalProgress(progress, currentUserId);
      scheduleSync(progress);
      updatePendingState(currentUserId);
    } catch (error) {
      // Reading must continue even when storage is disabled or full. A later
      // scroll can retry after the browser makes room.
      console.warn("Unable to persist local reading progress", error);
    }
  }
  return progress;
}

async function synchronizeForUser(userId: string): Promise<void> {
  currentUserId = userId;
  mergeAnonymousQueue(userId);
  updatePendingState(userId);

  try {
    const data = await fetchRemoteState(userId);
    const local = readProgressForUser(userId);
    const remote = data.progress
      .filter((item) => item.book === local?.book && item.tl === local?.tl)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];

    if (local && (!remote || local.updatedAt > remote.updatedAt)) {
      await syncNow(local);
    } else if (remote && (!local || remote.updatedAt > local.updatedAt)) {
      writeLocalProgress(remote, userId);
    }

    // Upload any queued pages even when progress was already up to date.
    await syncNow(local && (!remote || local.updatedAt >= remote.updatedAt) ? local : undefined);
    readingSyncState.update((state) => ({ ...state, error: null, online: true }));
  } catch (error) {
    if (
      !(error instanceof Error && error.message === "not-authenticated") &&
      !(error instanceof Error && error.message === "account-changed")
    ) {
      readingSyncState.update((state) => ({
        ...state,
        online: navigator.onLine,
        error: "Sync paused",
      }));
    }
  }
}

export async function startReadingSync(): Promise<void> {
  if (!browser) return;
  startAuth();
  if (!get(authState).ready) await refreshAuth();
  if (!started) {
    started = true;
    unsubscribeAuth = authState.subscribe((state) => {
      const userId = state.user?.id || null;
      if (userId === currentUserId) return;
      if (!userId) {
        const hadAuthenticatedUser = currentUserId !== null;
        currentUserId = null;
        // Do not leave a previous account's shared Continue Reading value
        // visible to a different account on a shared browser. Its private
        // namespaced cache remains available if that account signs in again.
        // On the first anonymous load there is no previous account to clear.
        if (hadAuthenticatedUser) {
          localStorage.removeItem(LAST_READ_KEY);
          localStorage.removeItem(PROGRESS_OWNER_KEY);
        }
        remoteProgress = new Map();
        remoteDaily = {};
        readingSyncState.update((state) => ({ ...state, daily: {}, todayPages: 0 }));
        initialSync = null;
        updatePendingState(null);
        return;
      }
      initialSync = synchronizeForUser(userId);
    });
    window.addEventListener("online", () => {
      if (currentUserId) void syncNow();
    });
    window.addEventListener("focus", () => {
      if (currentUserId) void syncNow();
    });
  }
  if (initialSync) await initialSync;
}

export async function getBestProgress(book: string): Promise<ReadingProgress | null> {
  if (!browser) return null;
  await startReadingSync();
  const local = readProgressForUser(localProgressUserKey());
  const candidates = [...remoteProgress.values()].filter((item) => item.book === book);
  const remote = candidates.sort((a, b) => b.updatedAt - a.updatedAt)[0];
  if (remote && (!local || local.book !== book || remote.updatedAt > local.updatedAt)) {
    writeLocalProgress(remote, currentUserId);
    return remote;
  }
  return local?.book === book ? local : null;
}

export function getCurrentLocalProgress(): ReadingProgress | null {
  if (!browser) return null;
  return readProgressForUser(localProgressUserKey());
}

export function stopReadingSync(): void {
  if (unsubscribeAuth) unsubscribeAuth();
  unsubscribeAuth = null;
  started = false;
  currentUserId = null;
}
