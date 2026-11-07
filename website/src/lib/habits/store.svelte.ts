// Browser runtime for reading habits: local persistence per account, the
// reader hook, celebrations, and cross-device sync with /api/reading/habits.
// Habits work without an account; signing in merges this browser's progress
// into the account, which the Android app shares.

import { browser } from "$app/environment";
import { get, writable } from "svelte/store";
import { authState, refreshAuth, startAuth } from "$lib/auth.svelte";
import { HabitEngine, freshHabits, validateHabits, type ChestReward, type HabitData, type XpGain } from "./engine";
import {
  SYNC_VERSION,
  applyDelta,
  diffDocs,
  freshDoc,
  fromDoc,
  isEmptyDelta,
  rebase,
  toDoc,
  validateDoc,
  type HabitDoc,
} from "./sync";
import type { WeeklyTier } from "./constants";

const DATA_PREFIX = "readerHabits:";
const SYNC_PREFIX = "readerHabitSync:";
const CELEBRATION_KEY = "readerHabitCelebrations";
const ANONYMOUS = "anonymous";
const SYNC_DEBOUNCE_MS = 2_000;
const SYNC_INTERVAL_MS = 120_000;
const KEEPALIVE_LIMIT = 60_000;

export type HabitSyncStatus = {
  signedIn: boolean;
  syncing: boolean;
  lastSyncedAt: number | null;
  error: string | null;
};

export type HabitView = {
  engine: HabitEngine;
  /** Bumped on every change so components re-read the engine. */
  version: number;
  owner: string;
  sync: HabitSyncStatus;
};

type SyncRecord = {
  base: HabitDoc | null;
  pending: { id: string; snapshot: HabitDoc } | null;
};

export type HabitToast = { id: number; icon: string; text: string; tone: "gold" | "sage" | "frost" | "mystic" | "ember" };

let engine = new HabitEngine();
let owner = ANONYMOUS;
let version = 0;
let syncStatus: HabitSyncStatus = { signedIn: false, syncing: false, lastSyncedAt: null, error: null };

export const habitView = writable<HabitView>({ engine, version, owner, sync: syncStatus });
/** The latest XP award, for the reader HUD. */
export const xpGains = writable<XpGain | null>(null);
/** Small, immediate notices (goal met, streak extended, freeze used, …). */
export const habitToasts = writable<HabitToast[]>([]);
/** Big moments shown after leaving the reader: level, Sequence, badges, milestones. */
export const celebrationQueue = writable<string[]>([]);
/** True while a chest or weekly reward is on screen; celebrations wait for it. */
export const rewardDialogOpen = writable(false);

let started = false;
let syncTimer: ReturnType<typeof setTimeout> | undefined;
let syncInterval: ReturnType<typeof setInterval> | undefined;
let syncInFlight: Promise<void> | null = null;
let syncAgain = false;
let lastBump = 0;
let toastId = 0;

function publish(): void {
  version++;
  habitView.set({ engine, version, owner, sync: { ...syncStatus } });
}

function setSync(patch: Partial<HabitSyncStatus>): void {
  syncStatus = { ...syncStatus, ...patch };
  habitView.set({ engine, version, owner, sync: { ...syncStatus } });
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    // Reading must continue when storage is full or blocked.
    console.warn("Unable to save reading habits", error);
  }
}

function loadData(profile: string): HabitData | null {
  const raw = readJson<unknown>(DATA_PREFIX + profile);
  if (!raw) return null;
  try {
    return validateHabits(raw);
  } catch {
    try {
      localStorage.setItem(`${DATA_PREFIX}${profile}.corrupt`, localStorage.getItem(DATA_PREFIX + profile) ?? "");
    } catch {
      /* A fresh record is safer than a broken one. */
    }
    return null;
  }
}

function saveData(): void {
  writeJson(DATA_PREFIX + owner, engine.data);
}

function loadSync(profile: string): SyncRecord {
  const raw = readJson<{ base?: unknown; pending?: { id?: unknown; snapshot?: unknown } | null }>(
    SYNC_PREFIX + profile,
  );
  const base = raw?.base ? validateDoc(raw.base) : null;
  const pending =
    raw?.pending && typeof raw.pending.id === "string" && raw.pending.snapshot
      ? { id: raw.pending.id, snapshot: validateDoc(raw.pending.snapshot) }
      : null;
  return { base, pending };
}

function saveSync(profile: string, record: SyncRecord): void {
  writeJson(SYNC_PREFIX + profile, record);
}

function hasActivity(data: HabitData): boolean {
  return Object.keys(data.days).length > 0 || data.totalXp > 0;
}

function loadCelebrations(): void {
  try {
    const raw = sessionStorage.getItem(CELEBRATION_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    if (Array.isArray(list)) celebrationQueue.set(list.filter((e): e is string => typeof e === "string").slice(-30));
  } catch {
    /* Celebrations are best-effort. */
  }
}

celebrationQueue.subscribe((list) => {
  if (!browser) return;
  try {
    sessionStorage.setItem(CELEBRATION_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
});

const BIG_MOMENTS = ["level:", "sequence:", "achievement:", "streak:", "repaired:"];

function toast(icon: string, text: string, tone: HabitToast["tone"]): void {
  const item = { id: ++toastId, icon, text, tone };
  habitToasts.update((list) => [...list.slice(-3), item]);
  setTimeout(() => habitToasts.update((list) => list.filter((t) => t.id !== item.id)), 4_500);
}

/** Routes engine celebrations: small ones become toasts, big ones queue a dialog. */
function handleCelebrations(): void {
  const events = engine.consumeCelebrations();
  if (events.length === 0) return;
  const big: string[] = [];
  for (const event of events) {
    if (BIG_MOMENTS.some((prefix) => event.startsWith(prefix))) {
      big.push(event);
    } else if (event === "goal") {
      toast("ic:round-flag", "Daily goal complete · mystery chest unlocked", "sage");
    } else if (event === "quests") {
      toast("ic:round-task-alt", "All daily quests done · +15 XP", "sage");
    } else if (event.startsWith("streak-extended:")) {
      const n = Number(event.slice("streak-extended:".length));
      toast("ic:round-local-fire-department", n === 1 ? "Streak started" : `${n}-day streak`, "ember");
    } else if (event.startsWith("freeze-used:")) {
      const n = Number(event.slice("freeze-used:".length)) || 1;
      toast(
        "ic:round-ac-unit",
        n === 1 ? "A streak freeze covered your missed day" : `${n} streak freezes covered your missed days`,
        "frost",
      );
    } else if (event === "freeze-earned") {
      toast("ic:round-ac-unit", "Streak freeze earned", "frost");
    } else if (event === "focus") {
      toast("ic:round-center-focus-strong", "Focus reached · +25% XP this session", "mystic");
    } else if (event.startsWith("weekly-ready:")) {
      const names = ["Bronze", "Silver", "Gold"];
      const name = names[Number(event.slice("weekly-ready:".length))];
      if (name) toast("ic:round-emoji-events", `${name} weekly reward ready to claim`, "gold");
    }
  }
  if (big.length > 0) celebrationQueue.update((list) => [...list, ...big].slice(-30));
}

function useEngine(data: HabitData): void {
  engine = new HabitEngine(data);
  engine.reconcile(new Date());
  handleCelebrations();
  saveData();
  publish();
}

/** Switches the local profile when the signed-in account changes. */
function activate(nextOwner: string): void {
  if (nextOwner === owner && started) return;
  if (started) saveData();
  owner = nextOwner;
  let data = loadData(owner) ?? freshHabits();

  if (owner !== ANONYMOUS) {
    // Progress made while signed out joins the account, like page events do.
    const anonymous = loadData(ANONYMOUS);
    if (anonymous && hasActivity(anonymous)) {
      const merged = applyDelta(toDoc(data), diffDocs(toDoc(anonymous), freshDoc()));
      data = fromDoc(merged, data);
      const reset = freshHabits();
      reset.readerHud = anonymous.readerHud;
      writeJson(DATA_PREFIX + ANONYMOUS, reset);
    }
  }
  useEngine(data);
  setSync({ signedIn: owner !== ANONYMOUS, error: null, lastSyncedAt: null });
  if (owner !== ANONYMOUS) void syncHabits();
}

export function startHabits(): void {
  if (!browser || started) return;
  loadCelebrations();
  startAuth();
  const user = get(authState).user;
  activate(user?.id ?? ANONYMOUS);
  started = true;
  authState.subscribe((state) => {
    if (!state.ready) return;
    activate(state.user?.id ?? ANONYMOUS);
  });
  if (!get(authState).ready) void refreshAuth();

  window.addEventListener("focus", () => {
    engine.reconcile(new Date());
    handleCelebrations();
    publish();
    void syncHabits();
  });
  window.addEventListener("online", () => void syncHabits());
  window.addEventListener("pagehide", () => flushHabits());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushHabits();
  });
  // Another tab of this site read or synced: adopt its newer record.
  window.addEventListener("storage", (event) => {
    if (event.key !== DATA_PREFIX + owner || !event.newValue) return;
    try {
      // Replacing only the data keeps this tab's in-memory reading session.
      engine.data = validateHabits(JSON.parse(event.newValue));
      publish();
    } catch {
      /* ignore malformed writes */
    }
  });
  syncInterval = setInterval(() => {
    if (document.visibilityState === "visible") void syncHabits();
  }, SYNC_INTERVAL_MS);
}

function changed(): void {
  handleCelebrations();
  saveData();
  publish();
  scheduleSync();
}

/** Called by the reader on every scroll and when a chapter opens. */
export function recordHabitReading(input: { book: string; tl: string; slug: number; scroll: number; ratio: number }): void {
  if (!browser) return;
  if (!started) startHabits();
  const didChange = engine.recordReading({
    edition: `${input.book}/${input.tl}`,
    slug: input.slug,
    ratio: input.ratio,
    scroll: input.scroll,
  });
  if (didChange) {
    if (engine.latestGain) xpGains.set(engine.latestGain);
    changed();
    return;
  }
  // Session time still moves the focus meter; refresh at most once a second.
  const now = Date.now();
  if (now - lastBump > 1_000) {
    lastBump = now;
    publish();
  }
}

export function openChest(): ChestReward | null {
  const reward = engine.openChest(new Date());
  if (reward) changed();
  return reward;
}

export function claimWeekly(tier: number): WeeklyTier | null {
  const result = engine.claimWeekly(tier, new Date());
  if (result) changed();
  return result;
}

export function setDailyGoal(goal: string): void {
  if (engine.setGoal(goal)) changed();
}

export function setReaderHud(enabled: boolean): void {
  engine.setReaderHud(enabled);
  saveData();
  publish();
}

export function dismissCelebration(): void {
  celebrationQueue.update((list) => list.slice(1));
}

function scheduleSync(): void {
  if (owner === ANONYMOUS) return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = undefined;
    void syncHabits();
  }, SYNC_DEBOUNCE_MS);
}

function flushHabits(): void {
  saveData();
  if (owner === ANONYMOUS) return;
  if (syncTimer) {
    clearTimeout(syncTimer);
    syncTimer = undefined;
  }
  void syncHabits({ keepalive: true });
}

function randomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

class AuthError extends Error {}

async function request(body?: unknown, keepalive = false): Promise<HabitDoc> {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const response = await fetch("/api/reading/habits", {
    method: payload ? "POST" : "GET",
    credentials: "same-origin",
    cache: "no-store",
    keepalive: keepalive && (payload?.length ?? 0) < KEEPALIVE_LIMIT,
    headers: payload
      ? { "content-type": "application/json", accept: "application/json" }
      : { accept: "application/json" },
    body: payload,
  });
  if (response.status === 401) throw new AuthError("not-authenticated");
  const data = (await response.json().catch(() => null)) as { habits?: unknown } | null;
  if (!response.ok || !data?.habits) throw new Error("sync-failed");
  return validateDoc(data.habits);
}

/**
 * One sync round. A pending upload is always resent with its original id until
 * the server confirms it, so a lost response can never double-count.
 */
async function syncOnce(keepalive: boolean): Promise<void> {
  const profile = owner;
  if (profile === ANONYMOUS) return;
  const record = loadSync(profile);
  const base = record.base ?? freshDoc();
  let snapshot: HabitDoc;
  let confirmed: HabitDoc;

  if (record.pending) {
    snapshot = record.pending.snapshot;
    const delta = diffDocs(snapshot, base);
    confirmed = await request({ version: SYNC_VERSION, id: record.pending.id, delta }, keepalive);
  } else {
    snapshot = toDoc(engine.data);
    const delta = diffDocs(snapshot, base);
    if (isEmptyDelta(delta)) {
      if (keepalive) return;
      confirmed = await request();
    } else {
      const id = randomId();
      saveSync(profile, { base: record.base, pending: { id, snapshot } });
      confirmed = await request({ version: SYNC_VERSION, id, delta }, keepalive);
    }
  }
  if (owner !== profile) return; // Account changed while in flight.

  const local = toDoc(engine.data);
  const merged = rebase(confirmed, local, snapshot);
  saveSync(profile, { base: confirmed, pending: null });
  const before = JSON.stringify(engine.data);
  engine.data = fromDoc(merged, engine.data);
  engine.reconcile(new Date());
  handleCelebrations();
  if (JSON.stringify(engine.data) !== before) {
    saveData();
    publish();
  }
  // Local changes made during the request, or by reconcile, go up next round.
  if (!isEmptyDelta(diffDocs(toDoc(engine.data), confirmed))) syncAgain = true;
}

export function syncHabits(options: { keepalive?: boolean } = {}): Promise<void> {
  if (!browser || owner === ANONYMOUS) return Promise.resolve();
  if (syncInFlight) {
    syncAgain = true;
    return syncInFlight;
  }
  setSync({ syncing: true });
  const operation = syncOnce(Boolean(options.keepalive))
    .then(() => setSync({ syncing: false, error: null, lastSyncedAt: Date.now() }))
    .catch(async (error) => {
      if (error instanceof AuthError) {
        setSync({ syncing: false, error: "Sign in again to sync your progress." });
        await refreshAuth();
      } else {
        setSync({
          syncing: false,
          error: navigator.onLine ? "Progress sync paused. It is saved on this device." : "Offline. Progress will sync when connected.",
        });
      }
      syncAgain = false;
    })
    .finally(() => {
      syncInFlight = null;
      if (syncAgain) {
        syncAgain = false;
        scheduleSync();
      }
    });
  syncInFlight = operation;
  return operation;
}

export function stopHabits(): void {
  if (syncInterval) clearInterval(syncInterval);
  syncInterval = undefined;
}
