// Reading-habit rules shared by the website and the Android app
// (LOTM-Reader-Android/lib/habit_store.dart). Keep both in step: the values
// below decide XP, streaks and rewards, and the two clients sync one record.

export const XP_PER_PAGE = 2;
export const XP_PER_CHAPTER = 25;
export const MAX_FREEZES = 2;
export const FREEZE_EVERY_STREAK = 10;
export const DEFAULT_GOAL = "regular";
export const RETENTION_DAYS = 400;
export const LOGICAL_PAGE_HEIGHT = 800;

export const DAILY_GOALS: Record<string, { label: string; xp: number; hint: string }> = {
  casual: { label: "Casual", xp: 20, hint: "~10 pages a day" },
  regular: { label: "Regular", xp: 50, hint: "~25 pages a day" },
  serious: { label: "Serious", xp: 100, hint: "~50 pages a day" },
  intense: { label: "Intense", xp: 200, hint: "~100 pages a day" },
};

export function goalXp(goal: string): number {
  return DAILY_GOALS[goal]?.xp ?? DAILY_GOALS[DEFAULT_GOAL].xp;
}

export const LEVEL_TITLES = [
  "Newcomer",
  "Page Turner",
  "Chapter Hunter",
  "Lore Keeper",
  "Devoted Reader",
  "Pathwalker",
  "Mist Walker",
  "Diviner",
  "Beyonder",
  "Mystic",
];

export function levelTitle(level: number): string {
  return level <= LEVEL_TITLES.length
    ? LEVEL_TITLES[level - 1]
    : `Grand Mystic ${level - LEVEL_TITLES.length}`;
}

/** XP needed to go from `level` to `level + 1`. */
export function levelCost(level: number): number {
  return 100 + 50 * (level - 1);
}

export type LevelInfo = {
  level: number;
  xpIntoLevel: number;
  xpForNextLevel: number;
  title: string;
  progress: number;
};

export function levelForXp(totalXp: number): LevelInfo {
  let level = 1;
  let remaining = totalXp < 0 ? 0 : totalXp;
  while (remaining >= levelCost(level)) {
    remaining -= levelCost(level);
    level++;
  }
  const next = levelCost(level);
  return {
    level,
    xpIntoLevel: remaining,
    xpForNextLevel: next,
    title: levelTitle(level),
    progress: next <= 0 ? 1 : Math.min(1, Math.max(0, remaining / next)),
  };
}

/** Every three levels advance one Sequence of the Fool pathway. */
export const SEQUENCE_NAMES = [
  "Seer",
  "Clown",
  "Magician",
  "Faceless",
  "Marionettist",
  "Bizarro Sorcerer",
  "Scholar of Yore",
  "Miracle Invoker",
  "Attendant of Mysteries",
  "Fool",
];
export const LEVELS_PER_SEQUENCE = 3;

export type SequenceRank = {
  /** 9 (lowest) down to 0 (highest). */
  sequence: number;
  name: string;
  progress: number;
  nextName: string | null;
};

export function sequenceForLevel(info: LevelInfo): SequenceRank {
  const index = Math.min(9, Math.max(0, Math.floor((info.level - 1) / LEVELS_PER_SEQUENCE)));
  if (index >= 9) return { sequence: 0, name: SEQUENCE_NAMES[9], progress: 1, nextName: null };
  const into = info.level - 1 - index * LEVELS_PER_SEQUENCE + info.progress;
  return {
    sequence: 9 - index,
    name: SEQUENCE_NAMES[index],
    progress: Math.min(1, Math.max(0, into / LEVELS_PER_SEQUENCE)),
    nextName: SEQUENCE_NAMES[index + 1],
  };
}

export function rankIndexForLevel(level: number): number {
  return Math.min(9, Math.max(0, Math.floor((level - 1) / LEVELS_PER_SEQUENCE)));
}

export const TIER_XP_BONUS: Record<string, number> = {
  Unlit: 0,
  Spark: 0,
  Flame: 10,
  Blaze: 20,
  Inferno: 35,
  Eternal: 50,
};

/** Reading events closer than this belong to the same session. */
export const SESSION_GAP_SECONDS = 180;
export const FOCUS_MINUTES = 15;
export const FOCUS_BONUS_PCT = 25;

export type StreakTier = { name: string; minDays: number; color: string };

export const STREAK_TIERS: StreakTier[] = [
  { name: "Unlit", minDays: 0, color: "#4b5a66" },
  { name: "Spark", minDays: 1, color: "#e8a54b" },
  { name: "Flame", minDays: 7, color: "#f08a3c" },
  { name: "Blaze", minDays: 30, color: "#ff6a3d" },
  { name: "Inferno", minDays: 100, color: "#ff4d6d" },
  { name: "Eternal", minDays: 365, color: "#b28dff" },
];

export function streakTier(streak: number): StreakTier {
  let tier = STREAK_TIERS[0];
  for (const t of STREAK_TIERS) if (streak >= t.minDays) tier = t;
  return tier;
}

export const STREAK_MILESTONES = [3, 7, 14, 30, 50, 100, 150, 200, 250, 300, 365];

export function isStreakMilestone(streak: number): boolean {
  return STREAK_MILESTONES.includes(streak) || (streak > 365 && streak % 100 === 0);
}

export function nextStreakMilestone(streak: number): number {
  for (const m of STREAK_MILESTONES) if (m > streak) return m;
  return (Math.floor(streak / 100) + 1) * 100;
}

export function previousStreakMilestone(streak: number): number {
  let previous = 0;
  for (const m of STREAK_MILESTONES) if (m <= streak) previous = m;
  if (streak > 365) {
    const hundred = Math.floor(streak / 100) * 100;
    if (hundred > previous) previous = hundred;
  }
  return previous;
}

export const RESCUE_GOAL_MULTIPLIER = 2;
export const MAX_RESCUE_GAP = 3;
export const QUEST_BONUS_XP = 15;

export const RARITY_COLORS: Record<string, string> = {
  common: "#9fc2dd",
  rare: "#80bea4",
  epic: "#b28dff",
  legendary: "#ffc857",
};

export type WeeklyTier = {
  name: string;
  multiplier: number;
  rewardXp: number;
  color: string;
  freeze: boolean;
};

export const WEEKLY_TIERS: WeeklyTier[] = [
  { name: "Bronze", multiplier: 3, rewardXp: 20, color: "#c98b5a", freeze: false },
  { name: "Silver", multiplier: 5, rewardXp: 40, color: "#c4d0da", freeze: false },
  { name: "Gold", multiplier: 7, rewardXp: 75, color: "#ffc857", freeze: true },
];

export type AchievementCategory =
  | "streak"
  | "reading"
  | "xp"
  | "goals"
  | "habits"
  | "time"
  | "rewards";

export const ACHIEVEMENT_CATEGORIES: AchievementCategory[] = [
  "streak",
  "reading",
  "xp",
  "goals",
  "habits",
  "time",
  "rewards",
];

export const ACHIEVEMENT_CATEGORY_LABELS: Record<AchievementCategory, string> = {
  streak: "Streaks",
  reading: "Reading",
  xp: "XP & levels",
  goals: "Goals & quests",
  habits: "Habits",
  time: "Time & focus",
  rewards: "Rewards",
};

export type Achievement = {
  id: string;
  title: string;
  description: string;
  /** Iconify icon name, matching the Material icon used by the app. */
  icon: string;
  category: AchievementCategory;
  metric: string;
  target: number;
};

/** Material icon (Flutter `Icons.*`) to Iconify's Google Material Icons set. */
export function materialIcon(name: string, outlined = false): string {
  return `ic:${outlined ? "outline" : "round"}-${name.replace(/_/g, "-")}`;
}

const a = (
  id: string,
  title: string,
  description: string,
  icon: string,
  category: AchievementCategory,
  metric: string,
  target: number,
): Achievement => {
  const outlined = icon.endsWith("_outlined");
  return {
    id,
    title,
    description,
    icon: materialIcon(outlined ? icon.slice(0, -"_outlined".length) : icon, outlined),
    category,
    metric,
    target,
  };
};

// Same ids, order, metrics and targets as the app, so unlocks merge cleanly.
export const ACHIEVEMENTS: Achievement[] = [
  a("streak-3", "Three-Day Streak", "Read on 3 days in a row", "local_fire_department_outlined", "streak", "longestStreak", 3),
  a("streak-7", "Week of Reading", "Reach a 7-day streak", "local_fire_department_outlined", "streak", "longestStreak", 7),
  a("streak-14", "Fortnight Flame", "Reach a 14-day streak", "local_fire_department_outlined", "streak", "longestStreak", 14),
  a("streak-30", "Month of the Seer", "Reach a 30-day streak", "local_fire_department", "streak", "longestStreak", 30),
  a("streak-50", "Fifty Flames", "Reach a 50-day streak", "local_fire_department", "streak", "longestStreak", 50),
  a("streak-100", "Hundred Days", "Reach a 100-day streak", "whatshot", "streak", "longestStreak", 100),
  a("streak-200", "Unwavering", "Reach a 200-day streak", "whatshot", "streak", "longestStreak", 200),
  a("streak-365", "A Year in the Mist", "Reach a 365-day streak", "emoji_events", "streak", "longestStreak", 365),
  a("freezes-2", "Ice Keeper", "Hold 2 streak freezes at once", "ac_unit", "streak", "freezes", 2),
  a("freeze-saved", "Saved by the Frost", "Let a streak freeze protect a missed day", "severe_cold", "streak", "freezesUsed", 1),
  a("streak-repaired", "Phoenix Rising", "Rescue a broken streak by earning double your goal", "healing", "streak", "repairs", 1),
  a("comeback", "Welcome Back", "Return after a week or more away", "waving_hand_outlined", "streak", "comebacks", 1),
  a("first-page", "First Steps", "Read your first page", "menu_book_outlined", "reading", "totalPages", 1),
  a("pages-100", "Hundred Pages", "Read 100 pages", "auto_stories_outlined", "reading", "totalPages", 100),
  a("pages-1000", "Thousand Pages", "Read 1,000 pages", "auto_stories", "reading", "totalPages", 1000),
  a("pages-5000", "Tome Devourer", "Read 5,000 pages", "auto_stories", "reading", "totalPages", 5000),
  a("first-chapter", "Chapter Complete", "Finish a full chapter", "done_all", "reading", "totalChapters", 1),
  a("chapters-10", "Ten Chapters", "Finish 10 chapters", "library_books_outlined", "reading", "totalChapters", 10),
  a("chapters-50", "Half the Mystery", "Finish 50 chapters", "library_books_outlined", "reading", "totalChapters", 50),
  a("chapters-100", "Century of Chapters", "Finish 100 chapters", "local_library_outlined", "reading", "totalChapters", 100),
  a("chapters-250", "Sequence Ascension", "Finish 250 chapters", "local_library", "reading", "totalChapters", 250),
  a("chapters-500", "Half a Thousand", "Finish 500 chapters", "local_library", "reading", "totalChapters", 500),
  a("chapters-1000", "The Whole Saga", "Finish 1,000 chapters", "workspace_premium", "reading", "totalChapters", 1000),
  a("marathon", "Marathon Session", "Read 100 pages in a single day", "directions_run", "reading", "bestDayPages", 100),
  a("binge", "Binge Reader", "Finish 5 chapters in a single day", "fast_forward", "reading", "bestDayChapters", 5),
  a("two-worlds", "Two Worlds", "Finish a chapter of both novels", "public", "reading", "novels", 2),
  a("xp-100", "Warming Up", "Earn 100 total XP", "bolt", "xp", "totalXp", 100),
  a("xp-500", "Committed Reader", "Earn 500 total XP", "bolt", "xp", "totalXp", 500),
  a("xp-1000", "Deep into the Mist", "Earn 1,000 total XP", "bolt", "xp", "totalXp", 1000),
  a("xp-2500", "Avid Reader", "Earn 2,500 total XP", "bolt", "xp", "totalXp", 2500),
  a("xp-5000", "Walking the Path", "Earn 5,000 total XP", "auto_awesome", "xp", "totalXp", 5000),
  a("xp-10000", "Ten Thousand Whispers", "Earn 10,000 total XP", "auto_awesome", "xp", "totalXp", 10000),
  a("xp-25000", "Legend of the Mist", "Earn 25,000 total XP", "diamond_outlined", "xp", "totalXp", 25000),
  a("level-5", "Rising Reader", "Reach level 5", "trending_up", "xp", "level", 5),
  a("level-10", "Ascended Mystic", "Reach level 10", "military_tech", "xp", "level", 10),
  a("goal-1", "Goal Getter", "Meet your daily goal", "flag_outlined", "goals", "goalDays", 1),
  a("goal-7", "Consistent", "Meet your daily goal on 7 days", "flag", "goals", "goalDays", 7),
  a("goal-30", "Dedicated", "Meet your daily goal on 30 days", "flag", "goals", "goalDays", 30),
  a("goal-100", "Unstoppable", "Meet your daily goal on 100 days", "flag_circle", "goals", "goalDays", 100),
  a("perfect-week", "Perfect Week", "Meet your goal 7 days in a row", "event_available", "goals", "longestGoalStreak", 7),
  a("perfect-month", "Perfect Month", "Meet your goal 30 days in a row", "calendar_month", "goals", "longestGoalStreak", 30),
  a("overachiever", "Overachiever", "Earn double your daily goal in one day", "rocket_launch_outlined", "goals", "overtimeDays", 1),
  a("quests-1", "Quest Complete", "Finish all daily quests once", "task_alt", "goals", "questDays", 1),
  a("quests-10", "Questmaster", "Finish all daily quests on 10 days", "task_alt", "goals", "questDays", 10),
  a("quests-50", "Legendary Quester", "Finish all daily quests on 50 days", "stars", "goals", "questDays", 50),
  a("early-bird", "Early Bird", "Read before 7 AM", "wb_twilight", "habits", "earlyBird", 1),
  a("night-owl", "Night Owl", "Read between 11 PM and 4 AM", "nightlight_outlined", "habits", "nightOwl", 1),
  a("weekend-warrior", "Weekend Warrior", "Read on both days of a weekend", "weekend_outlined", "habits", "weekends", 1),
  a("weekend-10", "Weekend Devotee", "Read on both days of 10 weekends", "weekend", "habits", "weekends", 10),
  a("time-1h", "First Hour", "Read for 1 hour in total", "hourglass_empty", "time", "totalSeconds", 3600),
  a("time-10h", "Ten Hours Deep", "Read for 10 hours in total", "hourglass_bottom", "time", "totalSeconds", 36000),
  a("time-50h", "Fifty Hours in the Fog", "Read for 50 hours in total", "hourglass_full", "time", "totalSeconds", 180000),
  a("time-100h", "Keeper of Hours", "Read for 100 hours in total", "history_toggle_off", "time", "totalSeconds", 360000),
  a("focus-1", "In the Zone", `Read ${FOCUS_MINUTES} minutes in one sitting to enter focus`, "center_focus_strong", "time", "focusSessions", 1),
  a("focus-25", "Deep Diver", "Reach focus in 25 sessions", "scuba_diving", "time", "focusSessions", 25),
  a("session-30", "Lost in the Pages", "Read 30 minutes in one sitting", "self_improvement", "time", "longestSession", 1800),
  a("session-60", "Deep Immersion", "Read 60 minutes in one sitting", "spa", "time", "longestSession", 3600),
  a("chest-1", "Treasure Hunter", "Open your first mystery chest", "inventory_2_outlined", "rewards", "chestsOpened", 1),
  a("chest-10", "Chest Collector", "Open 10 mystery chests", "inventory_2", "rewards", "chestsOpened", 10),
  a("chest-50", "Hoard of the Fool", "Open 50 mystery chests", "savings", "rewards", "chestsOpened", 50),
  a("weekly-1", "Weekly Challenger", "Claim a weekly challenge reward", "military_tech_outlined", "rewards", "weeklyClaims", 1),
  a("weekly-gold", "Golden Week", "Reach the gold tier of a weekly challenge", "emoji_events_outlined", "rewards", "weeklyGolds", 1),
  a("weekly-gold-5", "Gilded Path", "Reach the gold tier in 5 weeks", "emoji_events", "rewards", "weeklyGolds", 5),
  a("bonus-100", "Burning Bright", "Earn 100 bonus XP from flame and focus multipliers", "whatshot_outlined", "rewards", "bonusXp", 100),
  a("bonus-1000", "Wildfire", "Earn 1,000 bonus XP from flame and focus multipliers", "local_fire_department", "rewards", "bonusXp", 1000),
];

export const ACHIEVEMENT_IDS = new Set(ACHIEVEMENTS.map((item) => item.id));

export function achievementById(id: string): Achievement | undefined {
  return ACHIEVEMENTS.find((item) => item.id === id);
}

/** Editions and chapter numbers that count toward habits (as in the app). */
export const EDITION_PATTERN = /^(lotm|coi)\/(webnovel|oldtl|pt-br)$/;
export const CHAPTER_KEY_PATTERN = /^(lotm|coi)\/(webnovel|oldtl|pt-br)\/[1-9][0-9]{0,3}$/;
export const FLOOR_KEY_PATTERN =
  /^(lotm|coi)\/(webnovel|oldtl|pt-br)\/[1-9][0-9]{0,3}\/\d{4}-\d{2}-\d{2}$/;
export const MAX_SLUG = 1500;
