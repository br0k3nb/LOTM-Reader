// Cross-device habit sync (protocol v1). Used by the server endpoint, the web
// client and — mirrored in Dart — the Android app (lib/habit_sync.dart). The
// shared test vectors in habit-sync-vectors.json keep the two in step.
//
// Every device keeps the full habit record locally and remembers `base`, the
// last record the server confirmed. To sync it sends `diff(local, base)` with a
// unique id; the server applies that delta to its record exactly once and
// returns the result, which becomes the new base. Changes made while the
// request was in flight are replayed on top (`rebase`).
//
// Merge rules:
// - counters (XP, pages, chapters, time, …) and per-day totals are added, so
//   reading on two devices adds up;
// - records (longest streak, best day, …) and page floors take the maximum;
// - dated sets (goal/freeze/rescue days, finished chapters, achievements,
//   weekly claims) are unions; when two devices earned the same once-only
//   thing while offline, the duplicate's counters and XP are refunded;
// - the daily goal is last-writer-wins by `goalUpdatedAt`.
// Device preferences (reader HUD, reminders) and in-progress state (bonus
// rounding carry, today's rescue offer, the reading session) stay local.

import {
  ACHIEVEMENT_IDS,
  CHAPTER_KEY_PATTERN,
  DAILY_GOALS,
  DEFAULT_GOAL,
  FLOOR_KEY_PATTERN,
  FREEZE_EVERY_STREAK,
  MAX_FREEZES,
  QUEST_BONUS_XP,
  RETENTION_DAYS,
  WEEKLY_TIERS,
  XP_PER_CHAPTER,
} from "./constants";
import { addDays, dateKey, isDateKey } from "./dates";
import { freshHabits, posInt, type ChestRewardRecord, type DayRecord, type HabitData } from "./engine";

export const SYNC_VERSION = 1;

/** Added together across devices. `freezes` may go down (spent). */
export const SYNC_COUNTERS = [
  "totalXp",
  "totalPages",
  "totalChapters",
  "freezes",
  "goalDays",
  "freezesUsed",
  "repairs",
  "comebacks",
  "questDays",
  "weekends",
  "overtimeDays",
  "totalSeconds",
  "focusSessions",
  "chestsOpened",
  "weeklyClaims",
  "weeklyGolds",
  "bonusXp",
  "rewardXp",
] as const;

/** Merged by maximum. */
export const SYNC_MAXIMA = [
  "longestStreak",
  "longestGoalStreak",
  "bestDayPages",
  "bestDayChapters",
  "bestDayXp",
  "earlyBird",
  "nightOwl",
  "longestSession",
] as const;

/** Merged by union. */
export const SYNC_SETS = [
  "freezeDates",
  "repairDates",
  "goalDates",
  "chaptersCompleted",
  "achievements",
] as const;

type Counter = (typeof SYNC_COUNTERS)[number];
type Maximum = (typeof SYNC_MAXIMA)[number];
type SetKey = (typeof SYNC_SETS)[number];

/** Floors only matter for today's dedupe and quests; keep a week of them. */
export const FLOOR_SYNC_DAYS = 7;
export const WEEK_CLAIM_DAYS = 63;
const MAX_COUNTER = 1_000_000_000;
const MAX_DAY_VALUE = 1_000_000;

export type HabitDoc = {
  version: 1;
  hours: number[];
  days: Record<string, DayRecord>;
  floors: Record<string, number>;
  weekClaims: Record<string, number[]>;
  achievementDates: Record<string, string>;
  freezeMilestones: number[];
  chestOpenedOn: string | null;
  chestReward: ChestRewardRecord | null;
  goalCelebratedOn: string | null;
  goal: string;
  goalUpdatedAt: number;
} & Record<Counter | Maximum, number> &
  Record<SetKey, string[]>;

export type HabitDelta = {
  add?: Partial<Record<Counter, number>>;
  hours?: number[];
  days?: Record<string, Partial<DayRecord>>;
  max?: Partial<Record<Maximum, number>>;
  floors?: Record<string, number>;
  sets?: Partial<Record<SetKey, string[]>>;
  freezeMilestones?: number[];
  weekClaims?: Record<string, number[]>;
  achievementDates?: Record<string, string>;
  chestOpenedOn?: string;
  chestReward?: ChestRewardRecord;
  goalCelebratedOn?: string;
  goal?: { value: string; at: number };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function int(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
    ? value
    : null;
}

function sorted<T>(map: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const key of Object.keys(map).sort()) out[key] = map[key];
  return out;
}

function cutoffKey(days: number, now: Date): string {
  return dateKey(addDays(now, -days));
}

export function freshDoc(): HabitDoc {
  return toDoc(freshHabits(), new Date());
}

/** The synced part of a habit record. */
export function toDoc(data: HabitData, now = new Date()): HabitDoc {
  const doc = { version: SYNC_VERSION } as HabitDoc;
  for (const key of SYNC_COUNTERS) doc[key] = data[key];
  for (const key of SYNC_MAXIMA) doc[key] = data[key];
  for (const key of SYNC_SETS) doc[key] = [...new Set(data[key])].sort();
  doc.hours = data.hours.length === 24 ? [...data.hours] : new Array(24).fill(0);
  doc.days = {};
  for (const [key, day] of Object.entries(data.days)) doc.days[key] = { ...day };
  doc.floors = {};
  const floorCutoff = cutoffKey(FLOOR_SYNC_DAYS, now);
  for (const [key, value] of Object.entries(data.floors)) {
    if ((key.split("/").pop() ?? "") >= floorCutoff) doc.floors[key] = value;
  }
  doc.weekClaims = {};
  for (const [week, tiers] of Object.entries(data.weekClaims)) doc.weekClaims[week] = [...tiers].sort((x, y) => x - y);
  doc.achievementDates = { ...data.achievementDates };
  doc.freezeMilestones = [...new Set(data.freezeMilestones)].sort((x, y) => x - y);
  doc.chestOpenedOn = data.chestOpenedOn;
  doc.chestReward = data.chestReward ? { ...data.chestReward } : null;
  doc.goalCelebratedOn = data.goalCelebratedOn;
  doc.goal = data.goal;
  doc.goalUpdatedAt = data.goalUpdatedAt;
  return canonical(doc);
}

/** Sorted map keys, so equal documents serialize identically everywhere. */
function canonical(doc: HabitDoc): HabitDoc {
  doc.days = sorted(doc.days);
  doc.floors = sorted(doc.floors);
  doc.weekClaims = sorted(doc.weekClaims);
  doc.achievementDates = sorted(doc.achievementDates);
  return doc;
}

/** Writes a merged document into a local record, keeping device-only fields. */
export function fromDoc(doc: HabitDoc, local: HabitData): HabitData {
  const next: HabitData = { ...local };
  for (const key of SYNC_COUNTERS) next[key] = doc[key];
  for (const key of SYNC_MAXIMA) next[key] = doc[key];
  for (const key of SYNC_SETS) next[key] = [...doc[key]];
  next.hours = [...doc.hours];
  next.days = {};
  for (const [key, day] of Object.entries(doc.days)) next.days[key] = { ...day };
  // Older floors are device-only history; synced ones win where both exist.
  next.floors = { ...local.floors };
  for (const [key, value] of Object.entries(doc.floors)) {
    next.floors[key] = Math.max(value, next.floors[key] ?? -1);
  }
  next.weekClaims = {};
  for (const [week, tiers] of Object.entries(doc.weekClaims)) next.weekClaims[week] = [...tiers];
  next.achievementDates = { ...doc.achievementDates };
  next.freezeMilestones = [...doc.freezeMilestones];
  next.chestOpenedOn = doc.chestOpenedOn;
  next.chestReward = doc.chestReward ? { ...doc.chestReward } : null;
  next.goalCelebratedOn = doc.goalCelebratedOn;
  next.goal = doc.goal;
  next.goalUpdatedAt = doc.goalUpdatedAt;
  return next;
}

/** Validates an untrusted document (server row or response). */
export function validateDoc(value: unknown, now = new Date()): HabitDoc {
  const doc = freshDoc();
  if (!isRecord(value) || value.version !== SYNC_VERSION) return doc;
  for (const key of SYNC_COUNTERS) {
    const raw = int(value[key], 0, MAX_COUNTER);
    if (raw !== null) doc[key] = raw;
  }
  doc.freezes = Math.min(MAX_FREEZES, doc.freezes);
  for (const key of SYNC_MAXIMA) {
    const raw = int(value[key], 0, MAX_COUNTER);
    if (raw !== null) doc[key] = raw;
  }
  const retention = cutoffKey(RETENTION_DAYS, now);
  for (const key of SYNC_SETS) {
    const raw = value[key];
    if (!Array.isArray(raw)) continue;
    const valid =
      key === "chaptersCompleted"
        ? (item: unknown) => typeof item === "string" && CHAPTER_KEY_PATTERN.test(item)
        : key === "achievements"
          ? (item: unknown) => typeof item === "string" && ACHIEVEMENT_IDS.has(item)
          : (item: unknown) => isDateKey(item) && item >= retention;
    doc[key] = [...new Set(raw.filter(valid) as string[])].sort();
  }
  if (Array.isArray(value.hours) && value.hours.length === 24) {
    doc.hours = value.hours.map((h) => Math.min(MAX_COUNTER, posInt(h)));
  }
  if (isRecord(value.days)) {
    for (const [key, raw] of Object.entries(value.days)) {
      if (!isDateKey(key) || key < retention || !isRecord(raw)) continue;
      const day: DayRecord = {
        pages: Math.min(MAX_DAY_VALUE, posInt(raw.pages)),
        chapters: Math.min(MAX_DAY_VALUE, posInt(raw.chapters)),
        xp: Math.min(MAX_DAY_VALUE, posInt(raw.xp)),
      };
      const seconds = Math.min(86_400, posInt(raw.seconds));
      if (seconds > 0) day.seconds = seconds;
      if (raw.quests === true) day.quests = true;
      doc.days[key] = day;
    }
  }
  if (isRecord(value.floors)) {
    const floorCutoff = cutoffKey(FLOOR_SYNC_DAYS, now);
    for (const [key, raw] of Object.entries(value.floors)) {
      const floor = int(raw, -1, 5000);
      if (floor !== null && FLOOR_KEY_PATTERN.test(key) && (key.split("/").pop() ?? "") >= floorCutoff) {
        doc.floors[key] = floor;
      }
    }
  }
  if (isRecord(value.weekClaims)) {
    const claimCutoff = cutoffKey(WEEK_CLAIM_DAYS, now);
    for (const [week, raw] of Object.entries(value.weekClaims)) {
      if (!isDateKey(week) || week < claimCutoff || !Array.isArray(raw)) continue;
      doc.weekClaims[week] = [
        ...new Set(raw.filter((t) => int(t, 0, WEEKLY_TIERS.length - 1) !== null) as number[]),
      ].sort((x, y) => x - y);
    }
  }
  if (isRecord(value.achievementDates)) {
    for (const [id, raw] of Object.entries(value.achievementDates)) {
      if (ACHIEVEMENT_IDS.has(id) && isDateKey(raw)) doc.achievementDates[id] = raw;
    }
  }
  if (Array.isArray(value.freezeMilestones)) {
    doc.freezeMilestones = [
      ...new Set(
        value.freezeMilestones.filter(
          (m) => int(m, FREEZE_EVERY_STREAK, MAX_COUNTER) !== null,
        ) as number[],
      ),
    ].sort((x, y) => x - y);
  }
  if (isDateKey(value.chestOpenedOn)) doc.chestOpenedOn = value.chestOpenedOn;
  if (isRecord(value.chestReward) && isDateKey(value.chestReward.on)) {
    doc.chestReward = {
      on: value.chestReward.on,
      xp: Math.min(10_000, posInt(value.chestReward.xp)),
      freeze: value.chestReward.freeze === true,
    };
  }
  if (isDateKey(value.goalCelebratedOn)) doc.goalCelebratedOn = value.goalCelebratedOn;
  if (typeof value.goal === "string" && DAILY_GOALS[value.goal]) doc.goal = value.goal;
  const goalAt = int(value.goalUpdatedAt, 0, Number.MAX_SAFE_INTEGER);
  if (goalAt !== null) doc.goalUpdatedAt = goalAt;
  return canonical(doc);
}

function diffSet(local: string[], base: string[]): string[] {
  const known = new Set(base);
  return [...new Set(local.filter((item) => !known.has(item)))].sort();
}

/** What `local` gained since `base`. Empty object when nothing changed. */
export function diffDocs(local: HabitDoc, base: HabitDoc): HabitDelta {
  const delta: HabitDelta = {};
  const add: Partial<Record<Counter, number>> = {};
  for (const key of SYNC_COUNTERS) {
    let change = local[key] - base[key];
    // Counters only grow locally; only freezes are spent.
    if (key !== "freezes" && change < 0) change = 0;
    if (change !== 0) add[key] = change;
  }
  if (Object.keys(add).length > 0) delta.add = add;

  const hours = local.hours.map((h, i) => Math.max(0, h - (base.hours[i] ?? 0)));
  if (hours.some((h) => h > 0)) delta.hours = hours;

  const days: Record<string, Partial<DayRecord>> = {};
  for (const [key, day] of Object.entries(local.days)) {
    const before = base.days[key];
    const change: Partial<DayRecord> = {};
    for (const field of ["pages", "chapters", "xp", "seconds"] as const) {
      const value = (day[field] ?? 0) - (before?.[field] ?? 0);
      if (value > 0) change[field] = value;
    }
    if (day.quests === true && before?.quests !== true) change.quests = true;
    // A first page of a day with no XP yet still marks the day as active.
    if (Object.keys(change).length > 0 || !before) days[key] = change;
  }
  if (Object.keys(days).length > 0) delta.days = days;

  const max: Partial<Record<Maximum, number>> = {};
  for (const key of SYNC_MAXIMA) if (local[key] > base[key]) max[key] = local[key];
  if (Object.keys(max).length > 0) delta.max = max;

  const floors: Record<string, number> = {};
  for (const [key, value] of Object.entries(local.floors)) {
    if (value > (base.floors[key] ?? -1)) floors[key] = value;
  }
  if (Object.keys(floors).length > 0) delta.floors = floors;

  const sets: Partial<Record<SetKey, string[]>> = {};
  for (const key of SYNC_SETS) {
    const added = diffSet(local[key], base[key]);
    if (added.length > 0) sets[key] = added;
  }
  if (Object.keys(sets).length > 0) delta.sets = sets;

  const knownMilestones = new Set(base.freezeMilestones);
  const milestones = local.freezeMilestones.filter((m) => !knownMilestones.has(m));
  if (milestones.length > 0) delta.freezeMilestones = milestones;

  const weekClaims: Record<string, number[]> = {};
  for (const [week, tiers] of Object.entries(local.weekClaims)) {
    const known = new Set(base.weekClaims[week] ?? []);
    const added = tiers.filter((t) => !known.has(t));
    if (added.length > 0) weekClaims[week] = added;
  }
  if (Object.keys(weekClaims).length > 0) delta.weekClaims = weekClaims;

  const achievementDates: Record<string, string> = {};
  for (const [id, date] of Object.entries(local.achievementDates)) {
    if (base.achievementDates[id] !== date) achievementDates[id] = date;
  }
  if (Object.keys(achievementDates).length > 0) delta.achievementDates = achievementDates;

  if (local.chestOpenedOn && local.chestOpenedOn !== base.chestOpenedOn) {
    delta.chestOpenedOn = local.chestOpenedOn;
  }
  if (local.chestReward && local.chestReward.on !== base.chestReward?.on) {
    delta.chestReward = { ...local.chestReward };
  }
  if (local.goalCelebratedOn && local.goalCelebratedOn !== base.goalCelebratedOn) {
    delta.goalCelebratedOn = local.goalCelebratedOn;
  }
  if (local.goalUpdatedAt > base.goalUpdatedAt) {
    delta.goal = { value: local.goal, at: local.goalUpdatedAt };
  }
  return delta;
}

export function isEmptyDelta(delta: HabitDelta): boolean {
  return Object.keys(delta).length === 0;
}

function clampCounter(key: Counter, value: number): number {
  if (key === "freezes") return Math.min(MAX_FREEZES, Math.max(0, value));
  return Math.min(MAX_COUNTER, Math.max(0, value));
}

/**
 * Applies a delta to a document and returns a new document. Deterministic and
 * identical on every platform; a delta must be applied at most once (the
 * server keeps the ids it has applied).
 */
export function applyDelta(doc: HabitDoc, delta: HabitDelta, now = new Date()): HabitDoc {
  const next = validateDoc(JSON.parse(JSON.stringify(doc)), now);
  const add: Partial<Record<Counter, number>> = { ...(delta.add ?? {}) };
  const bump = (key: Counter, by: number) => {
    add[key] = (add[key] ?? 0) + by;
  };

  // Once-only things earned on two devices while offline are refunded.
  const sets = delta.sets ?? {};
  for (const key of SYNC_SETS) {
    const incoming = sets[key] ?? [];
    if (incoming.length === 0) continue;
    const existing = new Set(next[key]);
    const duplicates = incoming.filter((item) => existing.has(item)).length;
    if (duplicates > 0) {
      if (key === "freezeDates") {
        bump("freezes", duplicates);
        bump("freezesUsed", -duplicates);
      } else if (key === "goalDates") {
        bump("goalDays", -duplicates);
      } else if (key === "repairDates") {
        if (duplicates === incoming.length && (add.repairs ?? 0) > 0) bump("repairs", -1);
      } else if (key === "chaptersCompleted") {
        bump("totalChapters", -duplicates);
        bump("totalXp", -duplicates * XP_PER_CHAPTER);
      }
    }
    next[key] = [...new Set([...next[key], ...incoming])].sort();
  }

  const knownMilestones = new Set(next.freezeMilestones);
  for (const milestone of delta.freezeMilestones ?? []) {
    if (knownMilestones.has(milestone)) bump("freezes", -1);
    knownMilestones.add(milestone);
  }
  next.freezeMilestones = [...knownMilestones].sort((x, y) => x - y);

  for (const [week, tiers] of Object.entries(delta.weekClaims ?? {})) {
    const claimed = new Set(next.weekClaims[week] ?? []);
    for (const tier of tiers) {
      if (claimed.has(tier)) {
        const reward = WEEKLY_TIERS[tier];
        bump("weeklyClaims", -1);
        if (tier === WEEKLY_TIERS.length - 1) bump("weeklyGolds", -1);
        bump("rewardXp", -reward.rewardXp);
        bump("totalXp", -reward.rewardXp);
        if (reward.freeze) bump("freezes", -1);
      }
      claimed.add(tier);
    }
    next.weekClaims[week] = [...claimed].sort((x, y) => x - y);
  }

  if (delta.chestOpenedOn) {
    if (next.chestOpenedOn === delta.chestOpenedOn) {
      bump("chestsOpened", -1);
      if (delta.chestReward?.on === delta.chestOpenedOn) {
        bump("rewardXp", -delta.chestReward.xp);
        bump("totalXp", -delta.chestReward.xp);
        if (delta.chestReward.freeze) bump("freezes", -1);
      }
    } else if (!next.chestOpenedOn || delta.chestOpenedOn > next.chestOpenedOn) {
      next.chestOpenedOn = delta.chestOpenedOn;
    }
  }
  if (delta.chestReward && (!next.chestReward || delta.chestReward.on > next.chestReward.on)) {
    next.chestReward = { ...delta.chestReward };
  }

  for (const [key, change] of Object.entries(delta.days ?? {})) {
    const day: DayRecord = { ...(next.days[key] ?? { pages: 0, chapters: 0, xp: 0 }) };
    let xp = change.xp ?? 0;
    if (change.quests === true && day.quests === true) {
      // Both devices paid the all-quests bonus for this day.
      bump("questDays", -1);
      bump("totalXp", -QUEST_BONUS_XP);
      xp -= QUEST_BONUS_XP;
    }
    day.pages = Math.min(MAX_DAY_VALUE, day.pages + (change.pages ?? 0));
    day.chapters = Math.min(MAX_DAY_VALUE, day.chapters + (change.chapters ?? 0));
    day.xp = Math.min(MAX_DAY_VALUE, Math.max(0, day.xp + xp));
    const seconds = Math.min(86_400, (day.seconds ?? 0) + (change.seconds ?? 0));
    if (seconds > 0) day.seconds = seconds;
    if (change.quests === true) day.quests = true;
    next.days[key] = day;
  }

  for (const key of SYNC_COUNTERS) {
    const change = add[key] ?? 0;
    if (change !== 0) next[key] = clampCounter(key, next[key] + change);
  }
  if (delta.hours) {
    next.hours = next.hours.map((h, i) => Math.min(MAX_COUNTER, h + Math.max(0, delta.hours?.[i] ?? 0)));
  }
  for (const key of SYNC_MAXIMA) {
    const value = delta.max?.[key];
    if (typeof value === "number" && value > next[key]) next[key] = value;
  }
  for (const [key, value] of Object.entries(delta.floors ?? {})) {
    if (value > (next.floors[key] ?? -1)) next.floors[key] = value;
  }
  for (const [id, date] of Object.entries(delta.achievementDates ?? {})) {
    const current = next.achievementDates[id];
    if (!current || date < current) next.achievementDates[id] = date;
  }
  if (
    delta.goalCelebratedOn &&
    (!next.goalCelebratedOn || delta.goalCelebratedOn > next.goalCelebratedOn)
  ) {
    next.goalCelebratedOn = delta.goalCelebratedOn;
  }
  if (delta.goal && delta.goal.at > next.goalUpdatedAt && DAILY_GOALS[delta.goal.value]) {
    next.goal = delta.goal.value;
    next.goalUpdatedAt = delta.goal.at;
  }
  // Re-validate to apply retention windows and bounds.
  return validateDoc(next, now);
}

/** Replays local changes made since `snapshot` on top of a confirmed document. */
export function rebase(confirmed: HabitDoc, local: HabitDoc, snapshot: HabitDoc, now = new Date()): HabitDoc {
  const delta = diffDocs(local, snapshot);
  return isEmptyDelta(delta) ? confirmed : applyDelta(confirmed, delta, now);
}

/** Strict validation of a delta received over the network. */
export function parseDelta(value: unknown): HabitDelta | null {
  if (!isRecord(value)) return null;
  const delta: HabitDelta = {};
  const allowed = new Set([
    "add",
    "hours",
    "days",
    "max",
    "floors",
    "sets",
    "freezeMilestones",
    "weekClaims",
    "achievementDates",
    "chestOpenedOn",
    "chestReward",
    "goalCelebratedOn",
    "goal",
  ]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) return null;

  if (value.add !== undefined) {
    if (!isRecord(value.add)) return null;
    delta.add = {};
    for (const [key, raw] of Object.entries(value.add)) {
      if (!(SYNC_COUNTERS as readonly string[]).includes(key)) return null;
      const n = int(raw, -MAX_COUNTER, MAX_COUNTER);
      if (n === null) return null;
      delta.add[key as Counter] = n;
    }
  }
  if (value.hours !== undefined) {
    if (!Array.isArray(value.hours) || value.hours.length !== 24) return null;
    const hours = value.hours.map((h) => int(h, 0, MAX_COUNTER));
    if (hours.some((h) => h === null)) return null;
    delta.hours = hours as number[];
  }
  if (value.days !== undefined) {
    if (!isRecord(value.days) || Object.keys(value.days).length > RETENTION_DAYS + 2) return null;
    delta.days = {};
    for (const [key, raw] of Object.entries(value.days)) {
      if (!isDateKey(key) || !isRecord(raw)) return null;
      const day: Partial<DayRecord> = {};
      for (const [field, fieldValue] of Object.entries(raw)) {
        if (field === "quests") {
          if (fieldValue !== true) return null;
          day.quests = true;
          continue;
        }
        if (!["pages", "chapters", "xp", "seconds"].includes(field)) return null;
        const n = int(fieldValue, 0, MAX_DAY_VALUE);
        if (n === null) return null;
        day[field as "pages" | "chapters" | "xp" | "seconds"] = n;
      }
      delta.days[key] = day;
    }
  }
  if (value.max !== undefined) {
    if (!isRecord(value.max)) return null;
    delta.max = {};
    for (const [key, raw] of Object.entries(value.max)) {
      if (!(SYNC_MAXIMA as readonly string[]).includes(key)) return null;
      const n = int(raw, 0, MAX_COUNTER);
      if (n === null) return null;
      delta.max[key as Maximum] = n;
    }
  }
  if (value.floors !== undefined) {
    if (!isRecord(value.floors) || Object.keys(value.floors).length > 20_000) return null;
    delta.floors = {};
    for (const [key, raw] of Object.entries(value.floors)) {
      const n = int(raw, -1, 5000);
      if (!FLOOR_KEY_PATTERN.test(key) || n === null) return null;
      delta.floors[key] = n;
    }
  }
  if (value.sets !== undefined) {
    if (!isRecord(value.sets)) return null;
    delta.sets = {};
    for (const [key, raw] of Object.entries(value.sets)) {
      if (!(SYNC_SETS as readonly string[]).includes(key) || !Array.isArray(raw) || raw.length > 20_000) {
        return null;
      }
      const valid =
        key === "chaptersCompleted"
          ? (item: unknown) => typeof item === "string" && CHAPTER_KEY_PATTERN.test(item)
          : key === "achievements"
            ? (item: unknown) => typeof item === "string" && ACHIEVEMENT_IDS.has(item)
            : isDateKey;
      if (!raw.every(valid)) return null;
      delta.sets[key as SetKey] = raw as string[];
    }
  }
  if (value.freezeMilestones !== undefined) {
    if (!Array.isArray(value.freezeMilestones) || value.freezeMilestones.length > 1000) return null;
    if (!value.freezeMilestones.every((m) => int(m, FREEZE_EVERY_STREAK, MAX_COUNTER) !== null)) return null;
    delta.freezeMilestones = value.freezeMilestones as number[];
  }
  if (value.weekClaims !== undefined) {
    if (!isRecord(value.weekClaims)) return null;
    delta.weekClaims = {};
    for (const [week, raw] of Object.entries(value.weekClaims)) {
      if (!isDateKey(week) || !Array.isArray(raw)) return null;
      if (!raw.every((t) => int(t, 0, WEEKLY_TIERS.length - 1) !== null)) return null;
      delta.weekClaims[week] = raw as number[];
    }
  }
  if (value.achievementDates !== undefined) {
    if (!isRecord(value.achievementDates)) return null;
    delta.achievementDates = {};
    for (const [id, raw] of Object.entries(value.achievementDates)) {
      if (!ACHIEVEMENT_IDS.has(id) || !isDateKey(raw)) return null;
      delta.achievementDates[id] = raw;
    }
  }
  for (const key of ["chestOpenedOn", "goalCelebratedOn"] as const) {
    if (value[key] === undefined) continue;
    if (!isDateKey(value[key])) return null;
    delta[key] = value[key] as string;
  }
  if (value.chestReward !== undefined) {
    const raw = value.chestReward;
    if (!isRecord(raw) || !isDateKey(raw.on) || int(raw.xp, 0, 10_000) === null || typeof raw.freeze !== "boolean") {
      return null;
    }
    delta.chestReward = { on: raw.on, xp: raw.xp as number, freeze: raw.freeze };
  }
  if (value.goal !== undefined) {
    const raw = value.goal;
    if (
      !isRecord(raw) ||
      typeof raw.value !== "string" ||
      !DAILY_GOALS[raw.value] ||
      int(raw.at, 0, Number.MAX_SAFE_INTEGER) === null
    ) {
      return null;
    }
    delta.goal = { value: raw.value, at: raw.at as number };
  }
  return delta;
}

export { DEFAULT_GOAL };
