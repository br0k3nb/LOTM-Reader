// Port of the Android app's HabitStore (LOTM-Reader-Android/lib/habit_store.dart).
// It is pure: storage, timers and sync live in store.svelte.ts. The data shape
// is the app's `habits.json`, so one account's record can move between them.

import {
  ACHIEVEMENTS,
  ACHIEVEMENT_IDS,
  CHAPTER_KEY_PATTERN,
  DAILY_GOALS,
  DEFAULT_GOAL,
  EDITION_PATTERN,
  FLOOR_KEY_PATTERN,
  FOCUS_BONUS_PCT,
  FOCUS_MINUTES,
  FREEZE_EVERY_STREAK,
  LOGICAL_PAGE_HEIGHT,
  MAX_FREEZES,
  MAX_RESCUE_GAP,
  MAX_SLUG,
  QUEST_BONUS_XP,
  RESCUE_GOAL_MULTIPLIER,
  RETENTION_DAYS,
  SESSION_GAP_SECONDS,
  TIER_XP_BONUS,
  WEEKLY_TIERS,
  XP_PER_CHAPTER,
  XP_PER_PAGE,
  goalXp,
  isStreakMilestone,
  levelForXp,
  rankIndexForLevel,
  sequenceForLevel,
  streakTier,
  type Achievement,
  type LevelInfo,
  type SequenceRank,
  type WeeklyTier,
} from "./constants";
import {
  addDays,
  dateKey,
  daysBetween,
  isDateKey,
  isoWeekday,
  mondayOf,
  parseDateKey,
  startOfDay,
} from "./dates";

export type DayRecord = {
  pages: number;
  chapters: number;
  xp: number;
  seconds?: number;
  quests?: true;
};

export type LostStreak = { on: string; length: number; gap: string[] };
export type ChestRewardRecord = { on: string; xp: number; freeze: boolean };

export type HabitData = {
  version: 1;
  totalXp: number;
  totalPages: number;
  totalChapters: number;
  freezes: number;
  longestStreak: number;
  goalDays: number;
  longestGoalStreak: number;
  bestDayPages: number;
  bestDayChapters: number;
  bestDayXp: number;
  freezesUsed: number;
  repairs: number;
  comebacks: number;
  questDays: number;
  earlyBird: number;
  nightOwl: number;
  weekends: number;
  overtimeDays: number;
  totalSeconds: number;
  longestSession: number;
  focusSessions: number;
  chestsOpened: number;
  weeklyClaims: number;
  weeklyGolds: number;
  bonusXp: number;
  rewardXp: number;
  bonusCarry: number;
  hours: number[];
  weekClaims: Record<string, number[]>;
  chestOpenedOn: string | null;
  chestReward: ChestRewardRecord | null;
  readerHud: boolean;
  days: Record<string, DayRecord>;
  freezeDates: string[];
  repairDates: string[];
  goalDates: string[];
  floors: Record<string, number>;
  chaptersCompleted: string[];
  achievements: string[];
  achievementDates: Record<string, string>;
  freezeMilestones: number[];
  lostStreak: LostStreak | null;
  goal: string;
  goalUpdatedAt: number;
  remindersEnabled: boolean;
  reminderTime: string;
  winBackEnabled: boolean;
  goalCelebratedOn: string | null;
};

export const INT_KEYS = [
  "totalXp",
  "totalPages",
  "totalChapters",
  "freezes",
  "longestStreak",
  "goalDays",
  "longestGoalStreak",
  "bestDayPages",
  "bestDayChapters",
  "bestDayXp",
  "freezesUsed",
  "repairs",
  "comebacks",
  "questDays",
  "earlyBird",
  "nightOwl",
  "weekends",
  "overtimeDays",
  "totalSeconds",
  "longestSession",
  "focusSessions",
  "chestsOpened",
  "weeklyClaims",
  "weeklyGolds",
  "bonusXp",
  "rewardXp",
  "bonusCarry",
] as const;

export type IntKey = (typeof INT_KEYS)[number];

const DATE_LIST_KEYS = ["freezeDates", "repairDates", "goalDates"] as const;

export function freshHabits(): HabitData {
  return {
    version: 1,
    totalXp: 0,
    totalPages: 0,
    totalChapters: 0,
    freezes: 1,
    longestStreak: 0,
    goalDays: 0,
    longestGoalStreak: 0,
    bestDayPages: 0,
    bestDayChapters: 0,
    bestDayXp: 0,
    freezesUsed: 0,
    repairs: 0,
    comebacks: 0,
    questDays: 0,
    earlyBird: 0,
    nightOwl: 0,
    weekends: 0,
    overtimeDays: 0,
    totalSeconds: 0,
    longestSession: 0,
    focusSessions: 0,
    chestsOpened: 0,
    weeklyClaims: 0,
    weeklyGolds: 0,
    bonusXp: 0,
    rewardXp: 0,
    bonusCarry: 0,
    hours: new Array(24).fill(0),
    weekClaims: {},
    chestOpenedOn: null,
    chestReward: null,
    readerHud: true,
    days: {},
    freezeDates: [],
    repairDates: [],
    goalDates: [],
    floors: {},
    chaptersCompleted: [],
    achievements: [],
    achievementDates: {},
    freezeMilestones: [],
    lostStreak: null,
    goal: DEFAULT_GOAL,
    goalUpdatedAt: 0,
    remindersEnabled: true,
    reminderTime: "20:00",
    winBackEnabled: true,
    goalCelebratedOn: null,
  };
}

export function posInt(raw: unknown): number {
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? Math.round(raw) : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Mirrors HabitStore._validate: unknown or out-of-range values fall back. */
export function validateHabits(value: unknown, now = new Date()): HabitData {
  if (!isRecord(value) || value.version !== 1) throw new Error("Unsupported habits data.");
  const next = freshHabits();
  for (const key of INT_KEYS) {
    const raw = value[key];
    if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) next[key] = Math.round(raw);
  }
  next.freezes = Math.min(MAX_FREEZES, Math.max(0, next.freezes));
  const cutoff = startOfDay(addDays(now, -RETENTION_DAYS));
  const recent = (key: unknown): key is string => {
    const d = parseDateKey(key);
    return d !== null && d.getTime() >= cutoff.getTime();
  };

  if (isRecord(value.days)) {
    for (const [key, day] of Object.entries(value.days)) {
      if (!recent(key) || !isRecord(day)) continue;
      const record: DayRecord = {
        pages: posInt(day.pages),
        chapters: posInt(day.chapters),
        xp: posInt(day.xp),
      };
      const seconds = posInt(day.seconds);
      if (seconds > 0) record.seconds = Math.min(86_400, seconds);
      if (day.quests === true) record.quests = true;
      next.days[key] = record;
    }
  }
  for (const listKey of DATE_LIST_KEYS) {
    const raw = value[listKey];
    if (Array.isArray(raw)) next[listKey] = [...new Set(raw.filter(recent))].sort();
  }
  if (isRecord(value.floors)) {
    for (const [key, raw] of Object.entries(value.floors)) {
      if (!recent(key.split("/").pop()) || !FLOOR_KEY_PATTERN.test(key)) continue;
      if (typeof raw === "number" && Number.isFinite(raw) && raw >= -1) {
        next.floors[key] = Math.min(5000, Math.max(-1, Math.floor(raw)));
      }
    }
  }
  if (Array.isArray(value.chaptersCompleted)) {
    next.chaptersCompleted = [
      ...new Set(
        value.chaptersCompleted.filter(
          (raw): raw is string => typeof raw === "string" && CHAPTER_KEY_PATTERN.test(raw),
        ),
      ),
    ];
  }
  if (Array.isArray(value.achievements)) {
    next.achievements = [
      ...new Set(
        value.achievements.filter(
          (raw): raw is string => typeof raw === "string" && ACHIEVEMENT_IDS.has(raw),
        ),
      ),
    ];
  }
  if (isRecord(value.achievementDates)) {
    for (const [id, raw] of Object.entries(value.achievementDates)) {
      if (ACHIEVEMENT_IDS.has(id) && isDateKey(raw)) next.achievementDates[id] = raw;
    }
  }
  if (Array.isArray(value.freezeMilestones)) {
    next.freezeMilestones = [
      ...new Set(
        value.freezeMilestones
          .filter(
            (raw): raw is number =>
              typeof raw === "number" && Number.isFinite(raw) && raw >= FREEZE_EVERY_STREAK,
          )
          .map((raw) => Math.round(raw)),
      ),
    ].sort((x, y) => x - y);
  }
  const lost = value.lostStreak;
  if (
    isRecord(lost) &&
    isDateKey(lost.on) &&
    typeof lost.length === "number" &&
    lost.length > 0 &&
    Array.isArray(lost.gap)
  ) {
    const gap = lost.gap.filter(isDateKey);
    if (gap.length > 0 && gap.length <= MAX_RESCUE_GAP) {
      next.lostStreak = { on: lost.on, length: Math.round(lost.length), gap };
    }
  }
  next.bonusCarry = Math.min(99, Math.max(0, next.bonusCarry));
  if (Array.isArray(value.hours) && value.hours.length === 24) {
    next.hours = value.hours.map(posInt);
  }
  if (isRecord(value.weekClaims)) {
    for (const [week, tiers] of Object.entries(value.weekClaims)) {
      if (!recent(week) || !Array.isArray(tiers)) continue;
      next.weekClaims[week] = [
        ...new Set(
          tiers.filter(
            (t): t is number => Number.isInteger(t) && t >= 0 && t < WEEKLY_TIERS.length,
          ),
        ),
      ].sort((x, y) => x - y);
    }
  }
  if (isDateKey(value.chestOpenedOn)) next.chestOpenedOn = value.chestOpenedOn;
  const reward = value.chestReward;
  if (isRecord(reward) && isDateKey(reward.on)) {
    next.chestReward = {
      on: reward.on,
      xp: Math.min(10_000, posInt(reward.xp)),
      freeze: reward.freeze === true,
    };
  }
  if (typeof value.readerHud === "boolean") next.readerHud = value.readerHud;
  if (typeof value.goal === "string" && DAILY_GOALS[value.goal]) next.goal = value.goal;
  if (typeof value.goalUpdatedAt === "number" && Number.isSafeInteger(value.goalUpdatedAt)) {
    next.goalUpdatedAt = Math.max(0, value.goalUpdatedAt);
  }
  if (typeof value.remindersEnabled === "boolean") next.remindersEnabled = value.remindersEnabled;
  if (typeof value.winBackEnabled === "boolean") next.winBackEnabled = value.winBackEnabled;
  if (typeof value.reminderTime === "string" && /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(value.reminderTime)) {
    next.reminderTime = value.reminderTime;
  }
  if (isDateKey(value.goalCelebratedOn)) next.goalCelebratedOn = value.goalCelebratedOn;
  return next;
}

export type DayState = "active" | "frozen" | "repaired" | "none";

export type DayActivity = {
  date: Date;
  key: string;
  pages: number;
  chapters: number;
  xp: number;
  state: DayState;
  goalMet: boolean;
  future: boolean;
};

export type DailyQuest = {
  id: string;
  title: string;
  icon: string;
  current: number;
  target: number;
  done: boolean;
  progress: number;
};

export type StreakRescue = {
  length: number;
  on: string;
  gap: string[];
  targetXp: number;
  currentXp: number;
  progress: number;
};

export type ChestReward = { rarity: "common" | "rare" | "epic" | "legendary"; xp: number; freeze: boolean };

export type WeeklyChallenge = {
  /** Monday of the week, as a date key. */
  week: string;
  xp: number;
  targets: number[];
  claimed: Set<number>;
  ends: Date;
  reached: (tier: number) => boolean;
  claimable: (tier: number) => boolean;
  claimableCount: number;
  progress: number;
  nextTier: number | null;
};

export type ReadingSession = {
  seconds: number;
  pages: number;
  xp: number;
  focus: boolean;
  focusProgress: number;
};

export type XpGain = {
  xp: number;
  bonus: number;
  bonusPct: number;
  chapter: boolean;
  at: number;
  id: number;
};

export type ReadingInsights = {
  activeDays: number;
  averageXp: number;
  averageMinutes: number;
  favoritePeriod: string | null;
  bestWeekday: string | null;
  chaptersPerDay: number;
};

function quest(id: string, title: string, icon: string, current: number, target: number): DailyQuest {
  return {
    id,
    title,
    icon,
    current,
    target,
    done: current >= target,
    progress: target <= 0 ? 1 : Math.min(1, Math.max(0, current / target)),
  };
}

/** Dart-compatible string hash: `codeUnits.fold(seed, (h, c) => (h * m + c) & 0x7fffffff)`. */
function foldHash(text: string, seed: number, multiplier: number): number {
  let h = seed;
  for (let i = 0; i < text.length; i++) h = (h * multiplier + text.charCodeAt(i)) & 0x7fffffff;
  return h;
}

/**
 * Duolingo-style motivation for steady reading: XP, levels, daily goals,
 * quests, streaks with freezes and same-day rescues, rewards and achievements.
 * Activity is counted in the same 800px logical pages as account sync, with
 * per-day/per-chapter floors so re-reading never double-counts.
 */
export class HabitEngine {
  data: HabitData;
  private celebrations: string[] = [];
  latestGain: XpGain | null = null;
  private gainId = 0;

  // Session tracking lives in memory: a session ends when the tab closes.
  private lastEventAt: number | null = null;
  private sessionSeconds = 0;
  private sessionPages = 0;
  private sessionXp = 0;
  private sessionFocused = false;
  private pendingSeconds = 0;
  private unsavedSeconds = 0;

  constructor(data: HabitData = freshHabits()) {
    this.data = data;
  }

  // ---- Accessors --------------------------------------------------------

  get totalXp() { return this.data.totalXp; }
  get freezes() { return this.data.freezes; }
  get goal() { return this.data.goal; }
  get goalTargetXp() { return goalXp(this.data.goal); }
  get level(): LevelInfo { return levelForXp(this.data.totalXp); }
  get sequence(): SequenceRank { return sequenceForLevel(this.level); }
  get readerHud() { return this.data.readerHud !== false; }
  get unlockedAchievements(): string[] { return [...this.data.achievements]; }

  achievementUnlockedOn(id: string): Date | null {
    return parseDateKey(this.data.achievementDates[id]);
  }

  todayKey(now = new Date()): string {
    return dateKey(now);
  }

  dayStats(key: string): { pages: number; chapters: number; xp: number; seconds: number } {
    const day = this.data.days[key];
    if (!day) return { pages: 0, chapters: 0, xp: 0, seconds: 0 };
    return { pages: day.pages || 0, chapters: day.chapters || 0, xp: day.xp || 0, seconds: day.seconds || 0 };
  }

  todayXp(now = new Date()) { return this.dayStats(dateKey(now)).xp; }
  todayPages(now = new Date()) { return this.dayStats(dateKey(now)).pages; }
  todayChapters(now = new Date()) { return this.dayStats(dateKey(now)).chapters; }
  goalMetToday(now = new Date()) { return this.todayXp(now) >= this.goalTargetXp; }
  todayGoalProgress(now = new Date()) {
    return Math.min(1, Math.max(0, this.todayXp(now) / this.goalTargetXp));
  }

  /** Whether today already counts toward the streak. */
  activeOn(now = new Date()): boolean {
    return dateKey(now) in this.data.days;
  }

  get lastActiveKey(): string | null {
    const keys = Object.keys(this.data.days).sort();
    return keys.length === 0 ? null : keys[keys.length - 1];
  }

  private bridgedDates(): Set<string> {
    return new Set([...this.data.freezeDates, ...this.data.repairDates]);
  }

  // ---- Lifecycle ---------------------------------------------------------

  /** Run after loading or merging: spend freezes, refresh records, prune. */
  reconcile(now = new Date()): void {
    this.reconcileFreezes(now);
    this.updateLongestStreak(now);
    this.backfillBests();
    this.maybeAwardFreeze();
    this.evaluateAchievements(now);
    this.prune(now);
  }

  /** Celebrations queued since the last call (same names as the app). */
  consumeCelebrations(): string[] {
    const pending = this.celebrations;
    this.celebrations = [];
    return pending;
  }

  // ---- Recording ---------------------------------------------------------

  /**
   * Records a scroll position for a chapter. New logical pages award XP; a
   * scroll ratio of 95% or more completes the chapter once. Returns whether the
   * data changed and should be persisted.
   */
  recordReading(input: {
    edition: string;
    slug: number;
    ratio?: number | null;
    scroll?: number;
    now?: Date;
  }): boolean {
    const { edition, slug } = input;
    if (!EDITION_PATTERN.test(edition) || !Number.isInteger(slug) || slug < 1 || slug > MAX_SLUG) {
      return false;
    }
    const at = input.now ?? new Date();
    const today = dateKey(at);
    const beforeLevel = levelForXp(this.data.totalXp).level;
    const beforeGoalMet = this.goalMetFor(today);
    const wasActive = today in this.data.days;
    const dayXpBefore = this.dayStats(today).xp;
    const previousActive = this.lastActiveBefore(today);
    const weeklyBefore = this.weeklyChallenge(at);
    const seconds = this.trackSession(at);

    const floorKey = `${edition}/${slug}/${today}`;
    const previous = this.data.floors[floorKey] ?? -1;
    const current = Math.min(5000, Math.max(0, Math.floor((input.scroll ?? 0) / LOGICAL_PAGE_HEIGHT)));
    let pages = 0;
    if (current > previous) {
      pages = current - previous;
      this.data.floors[floorKey] = current;
    }

    let chapterXp = 0;
    let chapterDone = false;
    const ratio = input.ratio;
    if (typeof ratio === "number" && Number.isFinite(ratio) && ratio >= 0.95) {
      const chapterKey = `${edition}/${slug}`;
      if (!this.data.chaptersCompleted.includes(chapterKey)) {
        this.data.chaptersCompleted.push(chapterKey);
        chapterXp = XP_PER_CHAPTER;
        chapterDone = true;
      }
    }

    if (pages === 0 && !chapterDone) {
      // Time spent re-reading still counts once the day has started.
      if (seconds > 0 && wasActive) {
        this.addToDay(today, { seconds });
        this.data.totalSeconds += seconds;
        this.unsavedSeconds += seconds;
        this.recordSessionStats();
        if (this.unsavedSeconds >= 30) {
          this.unsavedSeconds = 0;
          this.evaluateAchievements(at);
          return true;
        }
      } else if (seconds > 0) {
        this.pendingSeconds += seconds;
      }
      return false;
    }
    this.unsavedSeconds = 0;
    const time = seconds + this.pendingSeconds;
    this.pendingSeconds = 0;

    const base = pages * XP_PER_PAGE + chapterXp;
    const bonusPct = this.currentBonusPct(at);
    const carry = this.data.bonusCarry + base * bonusPct;
    const bonus = Math.floor(carry / 100);
    this.data.bonusCarry = carry % 100;
    this.data.bonusXp += bonus;
    const gained = base + bonus;
    this.addToDay(today, { pages, chapters: chapterDone ? 1 : 0, xp: gained, seconds: time });
    this.data.totalPages += pages;
    this.data.totalChapters += chapterDone ? 1 : 0;
    this.data.totalXp += gained;
    this.data.totalSeconds += time;
    this.sessionPages += pages;
    this.sessionXp += gained;
    this.recordSessionStats();
    if (this.data.hours.length === 24) {
      this.data.hours[at.getHours()] += pages > 0 ? pages : 1;
    }

    this.recordTimeOfDay(at);
    if (!wasActive) this.recordNewActiveDay(at, previousActive);

    // Quests complete first so their bonus counts toward the goal.
    const quests = this.questsFor(today);
    if (quests.every((q) => q.done) && this.data.days[today]?.quests !== true) {
      this.addToDay(today, { xp: QUEST_BONUS_XP, quests: true });
      this.data.totalXp += QUEST_BONUS_XP;
      this.data.questDays += 1;
      this.celebrations.push("quests");
    }

    this.reconcileFreezes(at);
    const repaired = this.tryRescue(at);
    const streak = this.currentStreak(at);

    if (!beforeGoalMet && this.goalMetFor(today) && this.data.goalCelebratedOn !== today) {
      this.data.goalCelebratedOn = today;
      this.data.goalDays += 1;
      this.data.goalDates = [...new Set([...this.data.goalDates, today])].sort();
      const goalRun = this.goalRunEndingAt(at);
      if (goalRun > this.data.longestGoalStreak) this.data.longestGoalStreak = goalRun;
      this.celebrations.push("goal");
    }
    const todayStats = this.dayStats(today);
    if (todayStats.xp >= this.goalTargetXp * 2 && dayXpBefore < this.goalTargetXp * 2) {
      this.data.overtimeDays += 1;
    }
    this.updateBests(todayStats);

    const weeklyAfter = this.weeklyChallenge(at);
    for (let i = 0; i < WEEKLY_TIERS.length; i++) {
      if (!weeklyBefore.reached(i) && weeklyAfter.reached(i)) this.celebrations.push(`weekly-ready:${i}`);
    }

    if (!wasActive) this.celebrations.push(`streak-extended:${streak}`);
    if ((!wasActive || repaired) && isStreakMilestone(streak)) this.celebrations.push(`streak:${streak}`);

    this.updateLongestStreak(at);
    this.maybeAwardFreeze();
    this.evaluateAchievements(at);
    this.celebrateLevel(beforeLevel);
    this.latestGain = { xp: gained, bonus, bonusPct, chapter: chapterDone, at: at.getTime(), id: ++this.gainId };
    return true;
  }

  private celebrateLevel(beforeLevel: number): void {
    const afterLevel = this.level.level;
    if (afterLevel <= beforeLevel) return;
    this.celebrations.push(`level:${afterLevel}`);
    const rankBefore = rankIndexForLevel(beforeLevel);
    const rankAfter = rankIndexForLevel(afterLevel);
    if (rankAfter > rankBefore) this.celebrations.push(`sequence:${9 - rankAfter}`);
  }

  /**
   * Folds the time since the last reading event into the session and returns
   * the seconds to count. A gap over SESSION_GAP_SECONDS starts a new session.
   */
  private trackSession(at: Date): number {
    const t = at.getTime();
    const last = this.lastEventAt;
    let seconds = 0;
    if (last === null || Math.floor((t - last) / 1000) > SESSION_GAP_SECONDS) {
      this.sessionSeconds = 0;
      this.sessionPages = 0;
      this.sessionXp = 0;
      this.sessionFocused = false;
    } else if (t > last) {
      seconds = Math.floor((t - last) / 1000);
    }
    if (last === null || t >= last) this.lastEventAt = t;
    this.sessionSeconds += seconds;
    return seconds;
  }

  private recordSessionStats(): void {
    if (this.sessionSeconds > this.data.longestSession) this.data.longestSession = this.sessionSeconds;
    if (!this.sessionFocused && this.sessionSeconds >= FOCUS_MINUTES * 60) {
      this.sessionFocused = true;
      this.data.focusSessions += 1;
      this.celebrations.push("focus");
    }
  }

  /** The session in progress, or null after SESSION_GAP_SECONDS of quiet. */
  session(now = new Date()): ReadingSession | null {
    const last = this.lastEventAt;
    if (last === null || Math.floor((now.getTime() - last) / 1000) > SESSION_GAP_SECONDS) return null;
    return {
      seconds: this.sessionSeconds,
      pages: this.sessionPages,
      xp: this.sessionXp,
      focus: this.sessionSeconds >= FOCUS_MINUTES * 60,
      focusProgress: Math.min(1, Math.max(0, this.sessionSeconds / (FOCUS_MINUTES * 60))),
    };
  }

  /** Flame tier bonus plus the focus bonus, as a percentage of base XP. */
  currentBonusPct(now = new Date()): number {
    const tierBonus = TIER_XP_BONUS[streakTier(this.currentStreak(now)).name] ?? 0;
    const focus = this.session(now)?.focus ? FOCUS_BONUS_PCT : 0;
    return tierBonus + focus;
  }

  private addToDay(
    key: string,
    add: { pages?: number; chapters?: number; xp?: number; seconds?: number; quests?: boolean },
  ): void {
    const day: DayRecord = { ...(this.data.days[key] ?? { pages: 0, chapters: 0, xp: 0 }) };
    day.pages = (day.pages || 0) + (add.pages ?? 0);
    day.chapters = (day.chapters || 0) + (add.chapters ?? 0);
    day.xp = (day.xp || 0) + (add.xp ?? 0);
    if ((add.seconds ?? 0) > 0) day.seconds = Math.min(86_400, (day.seconds || 0) + (add.seconds ?? 0));
    if (add.quests) day.quests = true;
    this.data.days[key] = day;
  }

  private lastActiveBefore(key: string): string | null {
    let best: string | null = null;
    for (const k of Object.keys(this.data.days)) {
      if (k >= key) continue;
      if (best === null || k > best) best = k;
    }
    return best;
  }

  private recordTimeOfDay(at: Date): void {
    const hour = at.getHours();
    if (hour < 7 && hour >= 4) this.data.earlyBird = 1;
    if (hour >= 23 || hour < 4) this.data.nightOwl = 1;
  }

  /** Bookkeeping for the first reading of a day: weekends and long breaks. */
  private recordNewActiveDay(at: Date, previousActive: string | null): void {
    const d = startOfDay(at);
    const weekday = isoWeekday(d);
    if (weekday === 6 || weekday === 7) {
      const other = weekday === 7 ? addDays(d, -1) : addDays(d, 1);
      if (dateKey(other) in this.data.days) this.data.weekends += 1;
    }
    if (previousActive !== null) {
      const last = parseDateKey(previousActive);
      if (last && daysBetween(d, last) >= 8) this.data.comebacks += 1;
    }
  }

  private updateBests(day: { pages: number; chapters: number; xp: number }): void {
    if (day.pages > this.data.bestDayPages) this.data.bestDayPages = day.pages;
    if (day.chapters > this.data.bestDayChapters) this.data.bestDayChapters = day.chapters;
    if (day.xp > this.data.bestDayXp) this.data.bestDayXp = day.xp;
  }

  private backfillBests(): void {
    for (const key of Object.keys(this.data.days)) this.updateBests(this.dayStats(key));
  }

  private goalMetFor(key: string): boolean {
    return this.dayStats(key).xp >= this.goalTargetXp;
  }

  /** Walks back from `start`, counting active days and skipping bridged ones. */
  private runEndingAt(start: Date, bridged: Set<string>): number {
    let d = startOfDay(start);
    let streak = 0;
    const days = this.data.days;
    for (;;) {
      const key = dateKey(d);
      if (key in days) {
        streak++;
        d = addDays(d, -1);
      } else if (bridged.has(key)) {
        d = addDays(d, -1);
      } else {
        return streak;
      }
    }
  }

  private goalRunEndingAt(start: Date): number {
    const goals = new Set(this.data.goalDates);
    let d = startOfDay(start);
    let run = 0;
    while (goals.has(dateKey(d))) {
      run++;
      d = addDays(d, -1);
    }
    return run;
  }

  /** Consecutive goal days ending today or yesterday. */
  currentGoalStreak(now = new Date()): number {
    const d = startOfDay(now);
    return this.data.goalDates.includes(dateKey(d))
      ? this.goalRunEndingAt(d)
      : this.goalRunEndingAt(addDays(d, -1));
  }

  /**
   * Current streak. A day with no activity neither counts nor breaks the
   * streak while it is still open; a full missed day without a freeze ends it.
   */
  currentStreak(now = new Date()): number {
    const d = startOfDay(now);
    const days = this.data.days;
    const bridged = this.bridgedDates();
    const todayActive = dateKey(d) in days;
    const anchor = todayActive ? d : addDays(d, -1);
    if (!todayActive && !(dateKey(anchor) in days) && !bridged.has(dateKey(anchor))) return 0;
    return this.runEndingAt(anchor, bridged);
  }

  /**
   * Spends banked freezes on missed days between the last active day before
   * today and today. Freezes are only spent when they cover the whole gap; a
   * gap the bank cannot cover is remembered as a rescuable lost streak.
   */
  private reconcileFreezes(now: Date): void {
    const days = this.data.days;
    if (Object.keys(days).length === 0) return;
    const today = startOfDay(now);
    const todayKey = dateKey(today);
    const previous = this.lastActiveBefore(todayKey);
    if (previous === null) return;
    const bridged = this.bridgedDates();
    const missed: string[] = [];
    let d = addDays(parseDateKey(previous)!, 1);
    while (d.getTime() < today.getTime()) {
      const key = dateKey(d);
      if (!(key in days) && !bridged.has(key)) missed.push(key);
      d = addDays(d, 1);
    }
    if (missed.length === 0) return;
    const available = this.data.freezes;
    if (available < missed.length) {
      const lostLength = this.runEndingAt(parseDateKey(previous)!, bridged);
      const existing = this.data.lostStreak;
      if (lostLength >= 2 && missed.length <= MAX_RESCUE_GAP && !(existing && existing.on === todayKey)) {
        this.data.lostStreak = { on: todayKey, length: lostLength, gap: missed };
      }
      return;
    }
    this.data.freezes = available - missed.length;
    this.data.freezesUsed += missed.length;
    this.data.freezeDates = [...new Set([...this.data.freezeDates, ...missed])].sort();
    this.celebrations.push(`freeze-used:${missed.length}`);
  }

  /** A rescue that can still be earned today, if any. */
  streakRescue(now = new Date()): StreakRescue | null {
    const lost = this.data.lostStreak;
    if (!lost || lost.on !== dateKey(now)) return null;
    const bridged = this.bridgedDates();
    if (lost.gap.every((g) => bridged.has(g))) return null;
    const targetXp = this.goalTargetXp * RESCUE_GOAL_MULTIPLIER;
    const currentXp = this.dayStats(dateKey(now)).xp;
    return {
      length: lost.length,
      on: lost.on,
      gap: [...lost.gap],
      targetXp,
      currentXp,
      progress: Math.min(1, Math.max(0, currentXp / targetXp)),
    };
  }

  private tryRescue(now: Date): boolean {
    const rescue = this.streakRescue(now);
    if (!rescue || rescue.currentXp < rescue.targetXp) return false;
    this.data.repairDates = [...new Set([...this.data.repairDates, ...rescue.gap])].sort();
    this.data.repairs += 1;
    this.data.lostStreak = null;
    this.celebrations.push(`repaired:${this.currentStreak(now)}`);
    return true;
  }

  private updateLongestStreak(now: Date): void {
    const streak = this.currentStreak(now);
    if (streak > this.data.longestStreak) this.data.longestStreak = streak;
  }

  /** One freeze per FREEZE_EVERY_STREAK streak days, once each, max banked. */
  private maybeAwardFreeze(): void {
    const longest = this.data.longestStreak;
    if (longest < FREEZE_EVERY_STREAK) return;
    const awarded = [...this.data.freezeMilestones];
    let changed = false;
    for (let milestone = FREEZE_EVERY_STREAK; milestone <= longest; milestone += FREEZE_EVERY_STREAK) {
      if (awarded.includes(milestone)) continue;
      awarded.push(milestone);
      if (this.data.freezes < MAX_FREEZES) {
        this.data.freezes += 1;
        this.celebrations.push("freeze-earned");
      }
      changed = true;
    }
    if (changed) this.data.freezeMilestones = awarded.sort((x, y) => x - y);
  }

  private prune(now: Date): void {
    const cutoffKey = dateKey(addDays(now, -RETENTION_DAYS));
    for (const key of Object.keys(this.data.days)) if (key < cutoffKey) delete this.data.days[key];
    for (const listKey of DATE_LIST_KEYS) {
      this.data[listKey] = [...new Set(this.data[listKey])].filter((k) => k >= cutoffKey).sort();
    }
    for (const key of Object.keys(this.data.floors)) {
      if ((key.split("/").pop() ?? "") < cutoffKey) delete this.data.floors[key];
    }
    if (this.data.lostStreak && this.data.lostStreak.on !== dateKey(now)) this.data.lostStreak = null;
    const claimCutoff = dateKey(addDays(now, -63));
    for (const week of Object.keys(this.data.weekClaims)) {
      if (week < claimCutoff) delete this.data.weekClaims[week];
    }
  }

  // ---- Achievements -------------------------------------------------------

  metricValue(metric: string): number {
    switch (metric) {
      case "level":
        return this.level.level;
      case "novels":
        return new Set(this.data.chaptersCompleted.map((c) => c.split("/")[0])).size;
      default: {
        const value = (this.data as unknown as Record<string, unknown>)[metric];
        return typeof value === "number" ? value : 0;
      }
    }
  }

  achievementProgress(item: Achievement): number {
    return Math.min(item.target, Math.max(0, this.metricValue(item.metric)));
  }

  /** Locked achievements closest to unlocking, best first. */
  nextAchievements(count = 3): Achievement[] {
    const unlocked = new Set(this.data.achievements);
    return ACHIEVEMENTS.filter((item) => !unlocked.has(item.id) && this.metricValue(item.metric) > 0)
      .sort(
        (x, y) => this.achievementProgress(y) / y.target - this.achievementProgress(x) / x.target,
      )
      .slice(0, count);
  }

  private evaluateAchievements(at: Date): void {
    const unlocked = new Set(this.data.achievements);
    let changed = false;
    for (const item of ACHIEVEMENTS) {
      if (unlocked.has(item.id)) continue;
      if (this.metricValue(item.metric) < item.target) continue;
      unlocked.add(item.id);
      this.data.achievements.push(item.id);
      this.data.achievementDates[item.id] = dateKey(at);
      this.celebrations.push(`achievement:${item.id}`);
      changed = true;
    }
    if (changed) this.data.achievements = [...new Set(this.data.achievements)];
  }

  // ---- Quests -------------------------------------------------------------

  /**
   * Three quests for `key`: meeting the goal plus two picked from the date,
   * so they stay fixed all day (identical to the app's choice).
   */
  questsFor(key: string): DailyQuest[] {
    const stats = this.dayStats(key);
    const distinct = Object.keys(this.data.floors).filter((k) => k.endsWith(`/${key}`)).length;
    const target = this.goalTargetXp;
    const pageTarget = Math.min(60, Math.max(5, Math.floor(target / 4)));
    const chapterTarget = target >= 200 ? 2 : 1;
    const distinctTarget = target >= 100 ? 3 : 2;
    const overtime = Math.round((target * 3) / 2);
    const pool = [
      quest("pages", `Read ${pageTarget} pages`, "ic:outline-auto-stories", stats.pages, pageTarget),
      quest(
        "chapter",
        chapterTarget === 1 ? "Finish a chapter" : `Finish ${chapterTarget} chapters`,
        "ic:round-done-all",
        stats.chapters,
        chapterTarget,
      ),
      quest("distinct", `Open ${distinctTarget} different chapters`, "ic:outline-layers", distinct, distinctTarget),
      quest("overtime", `Earn ${overtime} XP`, "ic:outline-rocket-launch", stats.xp, overtime),
    ];
    const seed = foldHash(key, 7, 31);
    const first = seed % pool.length;
    const second = (first + 1 + (Math.floor(seed / pool.length) % (pool.length - 1))) % pool.length;
    return [
      quest("goal", "Meet your daily goal", "ic:outline-flag", stats.xp, target),
      pool[first],
      pool[second],
    ];
  }

  todayQuests(now = new Date()): DailyQuest[] {
    return this.questsFor(dateKey(now));
  }

  questBonusClaimedToday(now = new Date()): boolean {
    return this.data.days[dateKey(now)]?.quests === true;
  }

  // ---- Rewards ------------------------------------------------------------

  /** Reward XP raises the level but never counts toward goals or the challenge. */
  private grantRewardXp(xp: number): void {
    const beforeLevel = this.level.level;
    this.data.totalXp += xp;
    this.data.rewardXp += xp;
    this.celebrateLevel(beforeLevel);
  }

  private grantFreeze(): boolean {
    if (this.data.freezes >= MAX_FREEZES) return false;
    this.data.freezes += 1;
    return true;
  }

  chestAvailable(now = new Date()): boolean {
    const key = dateKey(now);
    return this.goalMetFor(key) && this.data.chestOpenedOn !== key;
  }

  chestOpenedToday(now = new Date()): boolean {
    return this.data.chestOpenedOn === dateKey(now);
  }

  /** The chest's contents are fixed per day so reloading can't re-roll them. */
  chestFor(key: string): ChestReward {
    const seed = foldHash(`${key}/chest`, 17, 37);
    const roll = Math.floor(seed / 7) % 100;
    const scale = Math.min(3, Math.max(0.5, this.goalTargetXp / 50));
    const xp = (value: number) => Math.round(value * scale);
    if (roll < 55) return { rarity: "common", xp: xp(10 + (seed % 11)), freeze: false };
    if (roll < 85) return { rarity: "rare", xp: xp(25 + (seed % 16)), freeze: false };
    if (roll < 97) {
      return this.data.freezes < MAX_FREEZES
        ? { rarity: "epic", xp: xp(20), freeze: true }
        : { rarity: "epic", xp: xp(60), freeze: false };
    }
    return { rarity: "legendary", xp: xp(100), freeze: this.data.freezes < MAX_FREEZES };
  }

  /** Opens today's chest; null when there is none to open. */
  openChest(now = new Date()): ChestReward | null {
    if (!this.chestAvailable(now)) return null;
    const key = dateKey(now);
    const reward = this.chestFor(key);
    this.data.chestOpenedOn = key;
    this.data.chestReward = { on: key, xp: reward.xp, freeze: reward.freeze };
    this.data.chestsOpened += 1;
    this.grantRewardXp(reward.xp);
    if (reward.freeze) this.grantFreeze();
    this.evaluateAchievements(now);
    return reward;
  }

  /** This week's challenge: XP earned Monday–today against three tiers. */
  weeklyChallenge(now = new Date()): WeeklyChallenge {
    const monday = mondayOf(now);
    let xp = 0;
    for (let i = 0; i < 7; i++) xp += this.dayStats(dateKey(addDays(monday, i))).xp;
    const week = dateKey(monday);
    const claimed = new Set(this.data.weekClaims[week] ?? []);
    const targets = WEEKLY_TIERS.map((tier) => this.goalTargetXp * tier.multiplier);
    const reached = (tier: number) => xp >= targets[tier];
    const claimable = (tier: number) => reached(tier) && !claimed.has(tier);
    let nextTier: number | null = null;
    for (let i = 0; i < targets.length; i++) {
      if (!reached(i)) {
        nextTier = i;
        break;
      }
    }
    return {
      week,
      xp,
      targets,
      claimed,
      ends: addDays(monday, 7),
      reached,
      claimable,
      claimableCount: targets.filter((_, i) => claimable(i)).length,
      progress: Math.min(1, Math.max(0, xp / targets[targets.length - 1])),
      nextTier,
    };
  }

  rewardsWaiting(now = new Date()): number {
    return (this.chestAvailable(now) ? 1 : 0) + this.weeklyChallenge(now).claimableCount;
  }

  claimWeekly(tierIndex: number, now = new Date()): WeeklyTier | null {
    const challenge = this.weeklyChallenge(now);
    if (tierIndex < 0 || tierIndex >= WEEKLY_TIERS.length || !challenge.claimable(tierIndex)) return null;
    const tier = WEEKLY_TIERS[tierIndex];
    this.data.weekClaims[challenge.week] = [...challenge.claimed, tierIndex].sort((x, y) => x - y);
    this.data.weeklyClaims += 1;
    if (tierIndex === WEEKLY_TIERS.length - 1) this.data.weeklyGolds += 1;
    this.grantRewardXp(tier.rewardXp);
    if (tier.freeze) this.grantFreeze();
    this.evaluateAchievements(now);
    return tier;
  }

  // ---- Journey and insights ---------------------------------------------

  /** Distinct chapter numbers finished in `book`, across translations. */
  completedChapters(book: string): Set<number> {
    const done = new Set<number>();
    for (const raw of this.data.chaptersCompleted) {
      if (raw.startsWith(`${book}/`)) done.add(Number(raw.split("/").pop()));
    }
    return done;
  }

  insights(now = new Date()): ReadingInsights {
    const days = this.recentDays(30, now);
    const active = days.filter((d) => d.xp > 0);
    let seconds = 0;
    for (const d of active) seconds += this.dayStats(d.key).seconds;
    const hours = this.data.hours;
    let period: string | null = null;
    if (hours.length === 24 && hours.some((h) => h > 0)) {
      const periods: [string, number[]][] = [
        ["Early mornings", [4, 5, 6, 7]],
        ["Mornings", [8, 9, 10, 11]],
        ["Afternoons", [12, 13, 14, 15, 16]],
        ["Evenings", [17, 18, 19, 20, 21]],
        ["Late nights", [22, 23, 0, 1, 2, 3]],
      ];
      let best = 0;
      for (const [name, range] of periods) {
        const sum = range.reduce((s, h) => s + hours[h], 0);
        if (sum > best) {
          best = sum;
          period = name;
        }
      }
    }
    const byWeekday = new Array(7).fill(0);
    for (const key of Object.keys(this.data.days)) {
      const d = parseDateKey(key);
      if (d) byWeekday[isoWeekday(d) - 1] += this.dayStats(key).xp;
    }
    const names = ["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"];
    let bestDay = -1;
    for (let i = 0; i < 7; i++) {
      if (byWeekday[i] > 0 && (bestDay < 0 || byWeekday[i] > byWeekday[bestDay])) bestDay = i;
    }
    const chapters = days.slice(16).reduce((s, d) => s + d.chapters, 0);
    return {
      activeDays: active.length,
      averageXp: active.length === 0 ? 0 : Math.round(active.reduce((s, d) => s + d.xp, 0) / active.length),
      averageMinutes: active.length === 0 ? 0 : Math.round(seconds / active.length / 60),
      favoritePeriod: period,
      bestWeekday: bestDay < 0 ? null : names[bestDay],
      chaptersPerDay: chapters / 14,
    };
  }

  // ---- Settings -----------------------------------------------------------

  setGoal(value: string, now = Date.now()): boolean {
    if (!DAILY_GOALS[value] || value === this.data.goal) return false;
    this.data.goal = value;
    this.data.goalUpdatedAt = now;
    return true;
  }

  setReaderHud(enabled: boolean): void {
    this.data.readerHud = enabled;
  }

  // ---- Calendar -----------------------------------------------------------

  private activity(d: Date, today: Date): DayActivity {
    const key = dateKey(d);
    const stats = this.dayStats(key);
    const state: DayState =
      stats.xp > 0
        ? "active"
        : this.data.freezeDates.includes(key)
          ? "frozen"
          : this.data.repairDates.includes(key)
            ? "repaired"
            : "none";
    return {
      date: d,
      key,
      pages: stats.pages,
      chapters: stats.chapters,
      xp: stats.xp,
      state,
      goalMet: this.data.goalDates.includes(key),
      future: d.getTime() > today.getTime(),
    };
  }

  /** The last `count` days, oldest first, including today. */
  recentDays(count: number, now = new Date()): DayActivity[] {
    const today = startOfDay(now);
    const result: DayActivity[] = [];
    for (let offset = count - 1; offset >= 0; offset--) {
      result.push(this.activity(addDays(today, -offset), today));
    }
    return result;
  }

  /** `weeks` Monday–Sunday weeks ending with the current one, oldest first. */
  calendarWeeks(weeks: number, now = new Date()): DayActivity[] {
    const today = startOfDay(now);
    const start = addDays(mondayOf(today), -7 * (weeks - 1));
    const result: DayActivity[] = [];
    for (let i = 0; i < weeks * 7; i++) result.push(this.activity(addDays(start, i), today));
    return result;
  }

  weekly(now = new Date()): { label: string; xp: number; today: boolean }[] {
    const todayKey = dateKey(now);
    return this.recentDays(7, now).map((d) => ({
      label: ["M", "T", "W", "T", "F", "S", "S"][isoWeekday(d.date) - 1],
      xp: d.xp,
      today: d.key === todayKey,
    }));
  }
}
