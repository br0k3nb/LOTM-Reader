<script lang="ts">
  // The web version of the Android app's Progress tab. Both read the same
  // habit record when signed in (see $lib/habits/sync.ts).
  import { onMount } from "svelte";
  import Icon from "@iconify/svelte";
  import bookData from "$lib/meta.json";
  import {
    claimWeekly,
    habitView,
    openChest,
    rewardDialogOpen,
    setDailyGoal,
    setReaderHud,
    startHabits,
    syncHabits,
  } from "$lib/habits/store.svelte";
  import {
    ACHIEVEMENTS,
    ACHIEVEMENT_CATEGORIES,
    ACHIEVEMENT_CATEGORY_LABELS,
    DAILY_GOALS,
    FOCUS_BONUS_PCT,
    FOCUS_MINUTES,
    FREEZE_EVERY_STREAK,
    MAX_FREEZES,
    QUEST_BONUS_XP,
    RARITY_COLORS,
    RESCUE_GOAL_MULTIPLIER,
    STREAK_TIERS,
    TIER_XP_BONUS,
    WEEKLY_TIERS,
    XP_PER_PAGE,
    levelTitle,
    nextStreakMilestone,
    previousStreakMilestone,
    streakTier,
    type Achievement,
    type WeeklyTier,
  } from "$lib/habits/constants";
  import type { ChestReward, DayActivity, HabitEngine } from "$lib/habits/engine";
  import { formatDuration, longDate, shortDate, thousands } from "$lib/habits/dates";
  import Bar from "$lib/habits/ui/Bar.svelte";
  import Confetti from "$lib/habits/ui/Confetti.svelte";
  import Flame from "$lib/habits/ui/Flame.svelte";
  import Ring from "$lib/habits/ui/Ring.svelte";
  import { EMBER, FROST, GOLD, MYSTIC, SAGE } from "$lib/habits/ui/palette";

  onMount(() => {
    startHabits();
    void syncHabits();
    // Keep "hours left" and session timers fresh while the page is open.
    const timer = setInterval(() => (tick = Date.now()), 30_000);
    return () => clearInterval(timer);
  });

  let tick = $state(Date.now());
  const view = $derived($habitView);
  // A fresh read-only view per published version, so every derived value and
  // template expression re-runs when habits change (the engine object itself
  // is mutated in place).
  const h = $derived(Object.create(view.engine) as HabitEngine);
  const now = $derived.by(() => (view.version, tick, new Date()));
  const todayKey = $derived(h.todayKey(now));

  // Streak hero.
  const streak = $derived(h.currentStreak(now));
  const tier = $derived(streakTier(streak));
  const tierIndex = $derived(STREAK_TIERS.indexOf(tier));
  const nextTier = $derived(tierIndex + 1 < STREAK_TIERS.length ? STREAK_TIERS[tierIndex + 1] : null);
  const tierBonus = $derived(TIER_XP_BONUS[tier.name] ?? 0);
  const activeToday = $derived(h.activeOn(now));
  const nextMilestone = $derived(nextStreakMilestone(streak));
  const prevMilestone = $derived(previousStreakMilestone(streak));
  const hoursLeft = $derived(
    Math.floor((new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime()) / 3_600_000),
  );
  const weekStrip = $derived(h.calendarWeeks(1, now));
  const rescue = $derived(h.streakRescue(now));

  // Today.
  const stats = $derived(h.dayStats(todayKey));
  const goal = $derived(DAILY_GOALS[h.goal]);
  const goalMet = $derived(h.goalMetToday(now));
  const goalStreak = $derived(h.currentGoalStreak(now));
  const session = $derived(h.session(now));
  const bonus = $derived(h.currentBonusPct(now));
  const quests = $derived(h.todayQuests(now));
  const questsDone = $derived(quests.filter((q) => q.done).length);

  // Rewards.
  const chestAvailable = $derived(h.chestAvailable(now));
  const chestOpened = $derived(h.chestOpenedToday(now));
  const weekly = $derived(h.weeklyChallenge(now));
  const weeklyDaysLeft = $derived(Math.ceil((weekly.ends.getTime() - now.getTime()) / 86_400_000));
  const waiting = $derived(h.rewardsWaiting(now));

  // Level.
  const level = $derived(h.level);
  const rank = $derived(h.sequence);

  // History.
  const week = $derived(h.weekly(now));
  const weekMax = $derived(Math.max(h.goalTargetXp, ...week.map((d) => d.xp)));
  const heat = $derived(h.calendarWeeks(18, now));
  const calendar = $derived(h.calendarWeeks(5, now));
  const insights = $derived(h.insights(now));
  const unlocked = $derived(new Set(h.unlockedAchievements));
  const almost = $derived(h.nextAchievements());

  const records = $derived([
    { icon: "ic:round-local-fire-department", color: EMBER, value: h.data.longestStreak, label: "Longest streak", time: false },
    { icon: "ic:round-event-available", color: SAGE, value: h.data.longestGoalStreak, label: "Best goal run", time: false },
    { icon: "ic:outline-flag", color: GOLD, value: h.data.goalDays, label: "Goal days", time: false },
    { icon: "ic:round-bolt", color: GOLD, value: h.data.bestDayXp, label: "Best day XP", time: false },
    { icon: "ic:outline-auto-stories", color: GOLD, value: h.data.totalPages, label: "Pages read", time: false },
    { icon: "ic:round-done-all", color: GOLD, value: h.data.totalChapters, label: "Chapters", time: false },
    { icon: "ic:round-hourglass-bottom", color: MYSTIC, value: h.data.totalSeconds, label: "Time read", time: true },
    { icon: "ic:round-self-improvement", color: MYSTIC, value: h.data.longestSession, label: "Longest sitting", time: true },
    { icon: "ic:round-task-alt", color: SAGE, value: h.data.questDays, label: "Quest days", time: false },
    { icon: "ic:outline-inventory-2", color: GOLD, value: h.data.chestsOpened, label: "Chests opened", time: false },
    { icon: "ic:outline-whatshot", color: EMBER, value: h.data.bonusXp, label: "Bonus XP", time: false },
    { icon: "ic:round-ac-unit", color: FROST, value: h.data.freezesUsed, label: "Freezes used", time: false },
  ]);

  // Journey through each novel (translations merged), like the app.
  const BOOKS = [
    { slug: "lotm", title: "Lord of the Mysteries", icon: "ic:round-menu-book", from: "#6f8f9a", to: "#b7d3dc" },
    { slug: "coi", title: "Circle of Inevitability", icon: "ic:round-hourglass-bottom", from: "#9a6f86", to: "#e0b7cc" },
  ];
  type Chapter = { slug: number; category: string };
  const catalog = bookData as unknown as Record<string, Record<string, Chapter[]>>;
  const journey = $derived(
    BOOKS.map((book) => {
      const editions = Object.values(catalog[book.slug] ?? {});
      const reference = editions.reduce<Chapter[]>((best, list) => (list.length > best.length ? list : best), []);
      const total = reference.length;
      const done = h.completedChapters(book.slug);
      const count = Math.min(total, done.size);
      const fraction = total === 0 ? 0 : count / total;
      const furthest = done.size > 0 ? Math.max(...done) : null;
      const volume = furthest === null ? null : (reference.find((c) => Number(c.slug) === furthest)?.category ?? null);
      const remaining = total - count;
      const pace = insights.chaptersPerDay;
      let projection: string;
      if (remaining <= 0) projection = "Finished. A true Beyonder of this story.";
      else if (pace <= 0) projection = "Finish a chapter to see when you will reach the end.";
      else {
        const days = Math.ceil(remaining / pace);
        const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
        projection =
          days > 3650
            ? "Read a little more each day to bring the finish line closer."
            : `At ${pace.toFixed(1)} chapters a day you finish ${longDate(date)}`;
      }
      const nextMark = [0.1, 0.25, 0.5, 0.75, 0.9, 1].find((m) => fraction < m) ?? 1;
      const toMark = Math.ceil(nextMark * total) - count;
      return { ...book, total, count, fraction, volume, remaining, projection, nextMark, toMark };
    }),
  );

  // Dialogs.
  let chestDialog: HTMLDialogElement;
  let chestReward = $state<ChestReward | null>(null);
  let weeklyDialog: HTMLDialogElement;
  let weeklyReward = $state<WeeklyTier | null>(null);
  let badgeDialog: HTMLDialogElement;
  let badge = $state<Achievement | null>(null);

  function showChest() {
    chestReward = null;
    rewardDialogOpen.set(true);
    chestDialog.showModal();
  }

  function revealChest() {
    chestReward = openChest();
    if (!chestReward) closeReward(chestDialog);
  }

  function claim(tierIndex: number) {
    const result = claimWeekly(tierIndex);
    if (!result) return;
    weeklyReward = result;
    rewardDialogOpen.set(true);
    weeklyDialog.showModal();
  }

  /** Closes a reward dialog and releases waiting celebrations right away. */
  function closeReward(target: HTMLDialogElement) {
    target.close();
    rewardDialogOpen.set(false);
  }

  function showBadge(item: Achievement) {
    badge = item;
    badgeDialog.showModal();
  }

  function heatLevel(day: DayActivity): number {
    const ratio = h.goalTargetXp <= 0 ? 0 : day.xp / h.goalTargetXp;
    return day.xp <= 0 ? 0 : ratio < 0.5 ? 1 : ratio < 1 ? 2 : ratio < 2 ? 3 : 4;
  }

  const HEAT = [
    "color-mix(in oklab, currentColor 8%, transparent)",
    `${GOLD}38`,
    `${GOLD}73`,
    `${GOLD}bf`,
    "#ffe2a3",
  ];

  function heatColor(day: DayActivity): string {
    if (day.future) return "transparent";
    if (day.state === "frozen") return `${FROST}8c`;
    if (day.state === "repaired") return `${SAGE}8c`;
    return HEAT[heatLevel(day)];
  }

  function calendarStyle(day: DayActivity): string {
    if (day.future) return "opacity:.25";
    if (day.goalMet) return `background:${GOLD};color:#1b1405;box-shadow:0 0 8px ${GOLD}66`;
    if (day.state === "active") return `background:#c98b5a;color:#1b1405`;
    if (day.state === "frozen") return `background:${FROST}55;color:${FROST}`;
    if (day.state === "repaired") return `background:${SAGE}55;color:${SAGE}`;
    return "";
  }

  function fmtMetric(item: Achievement, n: number): string {
    return item.metric === "totalSeconds" || item.metric === "longestSession" ? formatDuration(n) : thousands(n);
  }
</script>

<svelte:head>
  <title>Reading progress · LOTM-Reader</title>
  <meta name="description" content="Your reading streak, daily goal, quests, rewards and achievements." />
</svelte:head>

{#snippet label(text: string, trailing?: string, color?: string)}
  <div class="mb-2 mt-7 flex items-baseline justify-between px-1">
    <h2 class="text-xs font-bold uppercase tracking-[0.18em] opacity-60">{text}</h2>
    {#if trailing}<span class="text-xs font-bold" style="color:{color ?? 'inherit'}">{trailing}</span>{/if}
  </div>
{/snippet}

<main class="mx-auto w-full max-w-2xl px-4 pb-16 pt-20 sm:px-6">
  <header class="mb-4 flex items-center justify-between gap-3 px-1">
    <div>
      <h1 class="text-2xl font-bold text-primary">Your progress</h1>
      <p class="text-xs opacity-70">
        {#if view.sync.signedIn}
          {#if view.sync.syncing}
            Syncing with your account…
          {:else if view.sync.error}
            {view.sync.error}
          {:else}
            Synced with your account and the Android app.
          {/if}
        {:else}
          Saved in this browser. Sign in to sync it with the Android app.
        {/if}
      </p>
    </div>
    <a href="/book/" class="btn btn-soft btn-primary btn-sm rounded-full">
      <Icon icon="ic:round-menu-book" class="size-4" /> Read
    </a>
  </header>

  <!-- Streak hero -->
  <section
    class="rounded-3xl border p-5 text-center shadow-xl"
    style="border-color:{tier.color}{streak > 0 ? '52' : '26'};background:radial-gradient(120% 90% at 50% 20%, color-mix(in oklab, {tier.color} {streak > 0
      ? 16
      : 4}%, var(--color-base-200)) 0%, var(--color-base-200) 55%, var(--color-base-300) 100%)"
  >
    <div class="flex flex-wrap justify-center gap-1.5">
      <span
        class="badge badge-sm gap-1 border-0 font-bold"
        style="background:{tier.color}22;color:{tier.color}"
        title="Flame tiers: Spark 1+, Flame 7+ (+10% XP), Blaze 30+ (+20%), Inferno 100+ (+35%), Eternal 365+ (+50%)"
      >
        <Icon icon="ic:round-local-fire-department" class="size-3.5" />{tier.name.toUpperCase()}
      </span>
      {#if tierBonus > 0}
        <span class="badge badge-sm gap-1 border-0 font-bold" style="background:{GOLD}22;color:{GOLD}" title="Your {tier.name} flame adds {tierBonus}% to all XP you earn.">
          <Icon icon="ic:round-bolt" class="size-3.5" />+{tierBonus}%
        </span>
      {/if}
      <span
        class="badge badge-sm gap-1 border-0 font-bold"
        style="background:{FROST}22;color:{FROST}"
        title="Streak freezes protect missed days automatically. Earn one every {FREEZE_EVERY_STREAK} streak days, from chests or gold weeks (max {MAX_FREEZES})."
      >
        <Icon icon="ic:round-ac-unit" class="size-3.5" />× {h.freezes}
      </span>
    </div>
    <div class="mt-3 flex justify-center">
      <Flame color={tier.color} size={112} lit={streak > 0} outlined={!activeToday && streak > 0} />
    </div>
    <div class="text-7xl font-light leading-none tracking-tight tabular-nums">{streak}</div>
    <div class="mt-1 text-xs font-bold tracking-[0.2em]" style="color:{GOLD}">DAY STREAK</div>
    <div
      class="mx-auto mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold {!activeToday && streak > 0 ? 'animate-pulse' : ''}"
      style="color:{activeToday ? SAGE : streak > 0 ? EMBER : 'inherit'};background:color-mix(in oklab, {activeToday ? SAGE : streak > 0 ? EMBER : 'currentColor'} 12%, transparent)"
    >
      <Icon icon={activeToday ? "ic:round-check-circle" : streak > 0 ? "ic:round-schedule" : "ic:outline-play-circle"} class="size-4" />
      {#if activeToday}
        {streak === 1 ? "Streak started today — see you tomorrow" : "Streak extended today"}
      {:else if streak > 0}
        {hoursLeft <= 1 ? "Less than an hour left to keep your streak" : `Read today to keep it · ${hoursLeft}h left`}
      {:else}
        Read a page to start a streak
      {/if}
    </div>

    <div class="mt-5 grid grid-cols-7 gap-1.5">
      {#each weekStrip as day}
        <div class="flex flex-col items-center gap-1 text-[11px] {day.key === todayKey ? 'font-bold' : 'opacity-70'}">
          <span>{["M", "T", "W", "T", "F", "S", "S"][(day.date.getDay() + 6) % 7]}</span>
          <span
            class="grid size-8 place-items-center rounded-full border border-base-content/10"
            style={day.future
              ? "opacity:.3"
              : day.state === "active"
                ? `background:${tier.color};color:#140c05;border-color:transparent`
                : day.state === "frozen"
                  ? `background:${FROST}33;color:${FROST}`
                  : day.state === "repaired"
                    ? `background:${SAGE}33;color:${SAGE}`
                    : ""}
          >
            {#if day.state === "active"}
              <Icon icon="ic:round-local-fire-department" class="size-4" />
            {:else if day.state === "frozen"}
              <Icon icon="ic:round-ac-unit" class="size-4" />
            {:else if day.state === "repaired"}
              <Icon icon="ic:round-healing" class="size-4" />
            {/if}
          </span>
        </div>
      {/each}
    </div>

    <div class="mt-5 flex items-center justify-between text-[11px]">
      <span class="opacity-60">
        {streak >= nextMilestone ? "" : `${nextMilestone - streak} ${nextMilestone - streak === 1 ? "day" : "days"} to ${nextMilestone}`}
      </span>
      <span class="flex items-center gap-1 font-semibold" style="color:{tier.color}">
        <Icon icon="ic:outline-emoji-events" class="size-3.5" />{nextMilestone}-day milestone
      </span>
    </div>
    <div class="mt-1.5">
      <Bar
        value={nextMilestone - prevMilestone <= 0 ? 0 : (streak - prevMilestone) / (nextMilestone - prevMilestone)}
        from="color-mix(in oklab, {tier.color} 70%, #000)"
        to={tier.color}
        label="Progress to the next milestone"
      />
    </div>
    {#if nextTier}
      <p class="mt-2.5 text-[11px]" style="color:{nextTier.color}">
        {nextTier.minDays - streak} more {nextTier.minDays - streak === 1 ? "day" : "days"} to {nextTier.name}{(TIER_XP_BONUS[nextTier.name] ?? 0) > 0
          ? ` · +${TIER_XP_BONUS[nextTier.name]}% XP`
          : ""}
      </p>
    {/if}
  </section>

  {#if rescue}
    <section class="mt-4 rounded-3xl border p-4" style="border-color:{SAGE}66;background:{SAGE}14">
      <div class="flex items-center gap-3">
        <Icon icon="ic:round-healing" class="size-8 shrink-0" style="color:{SAGE}" />
        <div class="min-w-0 grow">
          <h3 class="font-semibold">Rescue your {rescue.length}-day streak</h3>
          <p class="text-xs opacity-75">
            Earn {rescue.targetXp} XP before midnight ({RESCUE_GOAL_MULTIPLIER}× your goal) to restore {rescue.gap.length === 1
              ? "the missed day"
              : `${rescue.gap.length} missed days`}. {rescue.currentXp}/{rescue.targetXp} XP so far.
          </p>
        </div>
      </div>
      <div class="mt-3"><Bar value={rescue.progress} from="{SAGE}88" to={SAGE} label="Rescue progress" /></div>
    </section>
  {/if}

  <!-- Rewards -->
  {@render label("Rewards", waiting > 0 ? `${waiting} ready` : undefined, GOLD)}
  <button
    class="flex w-full items-center gap-4 rounded-3xl border bg-base-200 p-4 text-left transition {chestAvailable
      ? 'chest-ready cursor-pointer hover:scale-[1.01]'
      : 'cursor-default'}"
    style="border-color:{chestAvailable ? `${GOLD}88` : 'color-mix(in oklab, currentColor 10%, transparent)'}"
    disabled={!chestAvailable}
    onclick={showChest}
  >
    <span class="grid size-16 shrink-0 place-items-center">
      {#if chestAvailable}
        <Icon icon="ic:round-inventory-2" class="size-10" style="color:{GOLD};filter:drop-shadow(0 0 10px {GOLD})" />
      {:else}
        <Icon icon={chestOpened ? "ic:outline-inventory-2" : "ic:outline-lock"} class="size-9" style="color:{chestOpened ? SAGE : 'inherit'};opacity:{chestOpened ? 1 : 0.4}" />
      {/if}
    </span>
    <span class="min-w-0 grow">
      <span class="block font-semibold">
        {chestAvailable ? "Mystery chest ready!" : chestOpened ? "Chest opened" : "Daily mystery chest"}
      </span>
      <span class="mt-0.5 block text-xs opacity-70">
        {chestAvailable
          ? "Open it. It may hold bonus XP or a streak freeze."
          : chestOpened
            ? `A new chest unlocks tomorrow · ${hoursLeft}h`
            : `Meet today's goal to unlock it · ${Math.max(0, h.goalTargetXp - h.todayXp(now))} XP to go`}
      </span>
      {#if !chestAvailable && !chestOpened}
        <span class="mt-2 block"><Bar value={h.todayGoalProgress(now)} height={5} label="Goal progress" /></span>
      {/if}
    </span>
    {#if chestAvailable}<Icon icon="ic:round-chevron-right" class="size-6" style="color:{GOLD}" />{/if}
  </button>

  <section class="mt-3 rounded-3xl border border-base-content/10 bg-base-200 p-4">
    <div class="flex items-center gap-2">
      <Icon icon="ic:outline-emoji-events" class="size-5" style="color:{GOLD}" />
      <h3 class="grow font-semibold">Weekly challenge</h3>
      <span class="text-[11px] font-semibold" style="color:{weeklyDaysLeft <= 1 ? EMBER : 'inherit'};opacity:{weeklyDaysLeft <= 1 ? 1 : 0.6}">
        {weeklyDaysLeft <= 1 ? "Ends tonight" : `${weeklyDaysLeft} days left`}
      </span>
    </div>
    <p class="mt-1 text-xs opacity-70">
      {weekly.nextTier === null
        ? `${weekly.xp} XP this week · gold reached`
        : `${weekly.xp} XP this week · ${weekly.targets[weekly.nextTier] - weekly.xp} to ${WEEKLY_TIERS[weekly.nextTier].name.toLowerCase()}`}
    </p>
    <div class="mt-3">
      <Bar value={weekly.progress} height={10} markers={weekly.targets.map((t) => t / weekly.targets[2])} shimmer={weekly.claimableCount > 0} label="Weekly XP" />
    </div>
    <div class="mt-3 grid grid-cols-3 gap-2">
      {#each WEEKLY_TIERS as t, i}
        {@const claimed = weekly.claimed.has(i)}
        {@const claimable = weekly.claimable(i)}
        <button
          class="flex flex-col items-center rounded-2xl border px-1.5 py-2.5 text-center {claimable ? 'chest-ready' : ''}"
          style="border-color:{claimable || claimed ? `${t.color}8c` : 'color-mix(in oklab, currentColor 10%, transparent)'};background:{claimable ? `${t.color}24` : 'transparent'}"
          disabled={!claimable}
          onclick={() => claim(i)}
        >
          <Icon icon={claimed ? "ic:round-verified" : "ic:round-emoji-events"} class="size-6" style="color:{weekly.reached(i) ? t.color : 'inherit'};opacity:{weekly.reached(i) ? 1 : 0.35}" />
          <span class="mt-1 text-xs font-semibold">{t.name}</span>
          <span class="text-[10px] {claimable ? 'font-bold' : 'opacity-60'}" style="color:{claimable ? t.color : 'inherit'}">
            {claimed ? "Claimed" : claimable ? "Claim" : `${weekly.targets[i]} XP`}
          </span>
          <span class="flex items-center gap-0.5 text-[10px] opacity-70">
            +{t.rewardXp} XP{#if t.freeze}<Icon icon="ic:round-ac-unit" class="size-3" style="color:{FROST}" />{/if}
          </span>
        </button>
      {/each}
    </div>
  </section>

  <!-- Today -->
  {@render label("Today")}
  <section class="rounded-3xl border bg-base-200 p-4" style="border-color:{goalMet ? `${SAGE}66` : 'color-mix(in oklab, currentColor 10%, transparent)'}">
    <div class="flex items-center gap-4">
      <Ring value={h.todayGoalProgress(now)} size={92} color={goalMet ? SAGE : GOLD} label="Daily goal">
        {#if goalMet}
          <Icon icon="ic:round-check" class="size-10" style="color:{SAGE}" />
        {:else}
          <span class="text-xl font-bold tabular-nums">{stats.xp}</span>
          <span class="mt-0.5 text-[10px] opacity-60">/ {goal.xp} XP</span>
        {/if}
      </Ring>
      <div class="min-w-0">
        <h3 class="font-semibold">Today's goal</h3>
        <p class="text-xs opacity-70">
          {goal.label} · {goal.xp} XP · {stats.pages} {stats.pages === 1 ? "page" : "pages"} · {stats.chapters}
          {stats.chapters === 1 ? "chapter" : "chapters"}
        </p>
        <p class="mt-2 text-xs leading-relaxed">
          {goalMet
            ? `Goal complete with ${h.todayXp(now)} XP. Come back tomorrow to keep it going.`
            : `${goal.xp - h.todayXp(now)} XP to go — about ${Math.ceil((goal.xp - h.todayXp(now)) / ((XP_PER_PAGE * (100 + bonus)) / 100))} pages.`}
        </p>
        {#if goalStreak > 1}
          <span class="badge badge-sm mt-2 gap-1 border-0" style="background:{SAGE}22;color:{SAGE}">
            <Icon icon="ic:round-event-available" class="size-3.5" />{goalStreak} days in a row on goal
          </span>
        {/if}
      </div>
    </div>
    <div class="mt-3 rounded-2xl border border-base-content/10 bg-base-100/40 p-3">
      <div class="flex items-center gap-2 text-xs font-medium">
        <Icon icon={session?.focus ? "ic:round-center-focus-strong" : "ic:round-timer"} class="size-4.5" style="color:{session?.focus ? MYSTIC : GOLD}" />
        <span class="grow">
          {#if !session}
            {formatDuration(stats.seconds)} read today
          {:else if session.focus}
            In focus · +{FOCUS_BONUS_PCT}% XP this session
          {:else}
            Session {formatDuration(session.seconds)} · focus in {Math.min(FOCUS_MINUTES, Math.max(1, FOCUS_MINUTES - Math.floor(session.seconds / 60)))}m
          {/if}
        </span>
        {#if bonus > 0}<span class="font-extrabold" style="color:{GOLD}">×{(1 + bonus / 100).toFixed(2)} XP</span>{/if}
      </div>
      {#if session}
        <div class="mt-2"><Bar value={session.focusProgress} height={5} from="{MYSTIC}88" to={MYSTIC} shimmer={session.focus} label="Focus" /></div>
      {/if}
    </div>
  </section>

  {@render label("Daily quests", `${questsDone}/${quests.length}`, questsDone === quests.length ? SAGE : undefined)}
  <section class="space-y-3 rounded-3xl border border-base-content/10 bg-base-200 p-4">
    {#each quests as q}
      <div class="flex items-center gap-3">
        <span class="grid size-9 shrink-0 place-items-center rounded-xl" style="background:{q.done ? SAGE : GOLD}1f;color:{q.done ? SAGE : GOLD}">
          <Icon icon={q.done ? "ic:round-check" : q.icon} class="size-5" />
        </span>
        <div class="min-w-0 grow">
          <div class="flex justify-between gap-2 text-sm">
            <span class="truncate {q.done ? 'line-through opacity-60' : ''}">{q.title}</span>
            <span class="text-xs tabular-nums opacity-60">{Math.min(q.current, q.target)}/{q.target}</span>
          </div>
          <div class="mt-1.5"><Bar value={q.progress} height={5} from={q.done ? `${SAGE}88` : `${GOLD}88`} to={q.done ? SAGE : GOLD} label={q.title} /></div>
        </div>
      </div>
    {/each}
    <p class="text-[11px] opacity-60">
      {h.questBonusClaimedToday(now) ? `All quests done · +${QUEST_BONUS_XP} XP bonus earned` : `Finish all three for a +${QUEST_BONUS_XP} XP bonus. New quests every day.`}
    </p>
  </section>

  <!-- Level -->
  {@render label("Level")}
  <section class="rounded-3xl border border-base-content/10 bg-base-200 p-4">
    <div class="flex items-center gap-3">
      <span class="grid size-12 place-items-center rounded-2xl border text-lg font-bold" style="color:{GOLD};border-color:{GOLD}59;background:linear-gradient(135deg,{GOLD}47,{GOLD}0f)">
        {level.level}
      </span>
      <div>
        <h3 class="font-semibold">Level {level.level} · {level.title}</h3>
        <p class="text-xs opacity-70">{thousands(h.totalXp)} XP in total</p>
      </div>
    </div>
    <div class="mt-3"><Bar value={level.progress} label="Level progress" /></div>
    <p class="mt-2 text-[11px] opacity-60">
      {level.xpForNextLevel - level.xpIntoLevel} XP to Level {level.level + 1} · {levelTitle(level.level + 1)}
    </p>
    <div class="mt-4 flex items-center gap-3 rounded-2xl border p-3.5" style="border-color:{MYSTIC}47;background:linear-gradient(135deg,{MYSTIC}24,{MYSTIC}08)">
      <Icon icon="ic:outline-science" class="size-10 shrink-0" style="color:{MYSTIC};filter:drop-shadow(0 0 8px {MYSTIC}88)" />
      <div class="min-w-0 grow">
        <div class="text-[10px] font-extrabold tracking-[0.16em]" style="color:{MYSTIC}">SEQUENCE {rank.sequence}</div>
        <div class="font-semibold">{rank.name}</div>
        <div class="mt-2"><Bar value={rank.progress} height={5} from="{MYSTIC}88" to={MYSTIC} shimmer={rank.progress > 0.8} label="Sequence progress" /></div>
        <p class="mt-1.5 text-[11px] opacity-60">
          {rank.nextName === null ? "The pinnacle of the pathway." : `Digesting the potion · Sequence ${rank.sequence - 1}: ${rank.nextName}`}
        </p>
      </div>
    </div>
  </section>

  <!-- Journey -->
  {@render label("Your journey")}
  <section class="divide-y divide-base-content/10 rounded-3xl border border-base-content/10 bg-base-200 px-4">
    {#each journey as j}
      <div class="py-4">
        <div class="flex items-center gap-2">
          <Icon icon={j.icon} class="size-5" style="color:{j.to}" />
          <h3 class="grow text-sm font-semibold">{j.title}</h3>
          <span class="text-sm font-bold" style="color:{j.to}">{(j.fraction * 100).toFixed(1)}%</span>
        </div>
        <div class="mt-2.5"><Bar value={j.fraction} from={j.from} to={j.to} markers={[0.25, 0.5, 0.75]} label="{j.title} progress" /></div>
        <p class="mt-2 text-xs">{j.count} of {j.total} chapters{j.volume ? ` · ${j.volume}` : ""}</p>
        {#if j.remaining > 0 && j.toMark > 0}
          <p class="text-[11px] font-semibold" style="color:{j.to}">
            {j.toMark} {j.toMark === 1 ? "chapter" : "chapters"} to {Math.round(j.nextMark * 100)}%
          </p>
        {/if}
        <p class="text-[11px] opacity-60">{j.projection}</p>
      </div>
    {/each}
  </section>

  <!-- Insights -->
  {@render label("Insights")}
  <section class="space-y-3 rounded-3xl border border-base-content/10 bg-base-200 p-4 text-xs">
    {#each [
      ["ic:outline-calendar-today", "Active days", `${insights.activeDays} of the last 30`],
      ["ic:round-bolt", "Average active day", `${insights.averageXp} XP · ${insights.averageMinutes} min`],
      ["ic:round-wb-twilight", "You read most in", insights.favoritePeriod ?? "Not enough data yet"],
      ["ic:round-event", "Strongest day", insights.bestWeekday ?? "Not enough data yet"],
      ["ic:round-speed", "Recent pace", `${insights.chaptersPerDay.toFixed(1)} chapters a day`],
    ] as row}
      <div class="flex items-center gap-3">
        <Icon icon={row[0]} class="size-4.5 shrink-0" style="color:{GOLD}" />
        <span class="grow opacity-70">{row[1]}</span>
        <span class="text-right font-semibold">{row[2]}</span>
      </div>
    {/each}
  </section>

  <!-- Records -->
  {@render label("Records")}
  <section class="grid grid-cols-2 gap-2.5 rounded-3xl border border-base-content/10 bg-base-200 p-3.5 sm:grid-cols-3">
    {#each records as r}
      <div class="flex items-center gap-2.5 rounded-2xl border border-base-content/10 bg-base-100/40 p-3">
        <Icon icon={r.icon} class="size-5 shrink-0" style="color:{r.color}" />
        <div class="min-w-0">
          <div class="text-base font-semibold tabular-nums">{r.time ? formatDuration(r.value) : thousands(r.value)}</div>
          <div class="truncate text-[11px] opacity-60">{r.label}</div>
        </div>
      </div>
    {/each}
  </section>

  <!-- This week -->
  {@render label("This week")}
  <section class="rounded-3xl border border-base-content/10 bg-base-200 p-4">
    <div class="flex items-center gap-2">
      <Icon icon="ic:round-bolt" class="size-5" style="color:{GOLD}" />
      <h3 class="grow font-semibold">XP earned</h3>
      <span class="text-xs opacity-60">{week.reduce((s, d) => s + d.xp, 0)} XP</span>
    </div>
    <div class="relative mt-4 h-32">
      <div
        class="absolute inset-x-0 border-t border-dashed"
        style="border-color:{SAGE}73;bottom:{24 + (h.goalTargetXp / weekMax) * 80}px"
        title="Daily goal"
      ></div>
      <div class="absolute inset-0 flex items-end gap-2">
        {#each week as d}
          {@const met = d.xp >= h.goalTargetXp}
          {@const color = met ? SAGE : GOLD}
          <div class="flex h-full grow flex-col items-center justify-end">
            <span class="mb-1 text-[10px]" style="color:{d.today ? GOLD : 'inherit'};opacity:{d.today ? 1 : 0.6}">{d.xp || ""}</span>
            <div
              class="w-full max-w-9 rounded-md"
              style="height:{Math.max(3, (d.xp / weekMax) * 80)}px;background:linear-gradient(to top,{color}{d.today ? 'aa' : '55'},{color}{d.today ? '' : '99'});{d.today
                ? `box-shadow:0 0 10px ${color}59`
                : ''}"
            ></div>
            <span class="mt-2 text-[11px] {d.today ? 'font-bold' : 'opacity-60'}" style="color:{d.today ? GOLD : 'inherit'}">{d.label}</span>
          </div>
        {/each}
      </div>
    </div>
    <div class="mt-3 flex gap-4 text-[11px] opacity-70">
      <span class="flex items-center gap-1.5"><span class="size-2.5 rounded-full" style="background:{GOLD}"></span>Below goal</span>
      <span class="flex items-center gap-1.5"><span class="size-2.5 rounded-full" style="background:{SAGE}"></span>Goal met</span>
    </div>
  </section>

  <!-- Heatmap -->
  {@render label("Reading heatmap")}
  <section class="rounded-3xl border border-base-content/10 bg-base-200 p-4">
    <div class="flex justify-between text-xs">
      <span class="font-semibold">{heat.filter((d) => d.xp > 0).length} active days</span>
      <span class="opacity-60">Last 18 weeks</span>
    </div>
    <div class="mt-3 grid grid-flow-col grid-rows-7 gap-[3px]" style="grid-template-columns:repeat(18,minmax(0,1fr))">
      {#each heat as day}
        <span
          class="aspect-square rounded-[3px] {day.future ? 'border border-base-content/10' : ''}"
          style="background:{heatColor(day)};{heatLevel(day) === 4 && !day.future ? `box-shadow:0 0 4px ${GOLD}66` : ''}"
          title={day.future ? shortDate(day.date) : `${shortDate(day.date)} · ${day.xp} XP`}
        ></span>
      {/each}
    </div>
    <div class="mt-3 flex items-center gap-1 text-[10px] opacity-70">
      Less
      {#each HEAT as c}<span class="size-2.5 rounded-[3px]" style="background:{c}"></span>{/each}
      More
    </div>
  </section>

  <!-- Calendar -->
  {@render label("Streak calendar")}
  <section class="rounded-3xl border border-base-content/10 bg-base-200 p-4">
    <div class="grid grid-cols-7 gap-1.5 text-center text-[11px]">
      {#each ["M", "T", "W", "T", "F", "S", "S"] as d}<span class="opacity-50">{d}</span>{/each}
      {#each calendar as day}
        <span
          class="grid aspect-square place-items-center rounded-lg text-xs {day.key === todayKey ? 'ring-2 ring-base-content/40' : ''}"
          style={calendarStyle(day) || "background:color-mix(in oklab, currentColor 6%, transparent)"}
          title="{shortDate(day.date)}{day.xp ? ` · ${day.xp} XP` : ''}"
        >
          {day.date.getDate()}
        </span>
      {/each}
    </div>
    <div class="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] opacity-70">
      <span class="flex items-center gap-1.5"><span class="size-2.5 rounded-full" style="background:{GOLD}"></span>Goal met</span>
      <span class="flex items-center gap-1.5"><span class="size-2.5 rounded-full" style="background:#c98b5a"></span>Read</span>
      <span class="flex items-center gap-1.5"><span class="size-2.5 rounded-full" style="background:{FROST}"></span>Freeze</span>
      <span class="flex items-center gap-1.5"><span class="size-2.5 rounded-full" style="background:{SAGE}"></span>Rescued</span>
    </div>
  </section>

  {#if almost.length > 0}
    {@render label("Almost there")}
    <section class="rounded-3xl border border-base-content/10 bg-base-200 p-2">
      {#each almost as item}
        <button class="flex w-full items-center gap-3 rounded-2xl p-2.5 text-left hover:bg-base-100/40" onclick={() => showBadge(item)}>
          <span class="grid size-10 shrink-0 place-items-center rounded-full bg-base-content/10"><Icon icon={item.icon} class="size-5 opacity-70" /></span>
          <span class="min-w-0 grow">
            <span class="flex justify-between gap-2 text-sm">
              <span class="truncate font-medium">{item.title}</span>
              <span class="text-xs opacity-60">{fmtMetric(item, h.achievementProgress(item))}/{fmtMetric(item, item.target)}</span>
            </span>
            <span class="mt-1.5 block"><Bar value={h.achievementProgress(item) / item.target} height={5} label={item.title} /></span>
          </span>
        </button>
      {/each}
    </section>
  {/if}

  <!-- Achievements -->
  {@render label(`Achievements · ${unlocked.size}/${ACHIEVEMENTS.length}`)}
  <section class="rounded-3xl border border-base-content/10 bg-base-200 p-4">
    <Bar value={unlocked.size / ACHIEVEMENTS.length} shimmer label="Achievements unlocked" />
    {#each ACHIEVEMENT_CATEGORIES as category}
      {@const items = ACHIEVEMENTS.filter((item) => item.category === category)}
      {@const count = items.filter((item) => unlocked.has(item.id)).length}
      <div class="mb-3 mt-5 flex justify-between text-sm">
        <span class="font-semibold">{ACHIEVEMENT_CATEGORY_LABELS[category]}</span>
        <span class="text-xs" style="color:{count === items.length ? GOLD : 'inherit'};opacity:{count === items.length ? 1 : 0.6}">{count}/{items.length}</span>
      </div>
      <div class="grid grid-cols-4 gap-x-1.5 gap-y-4 sm:grid-cols-6">
        {#each items as item}
          {@const isUnlocked = unlocked.has(item.id)}
          <button class="flex flex-col items-center gap-1.5 text-center" onclick={() => showBadge(item)} aria-label="{item.title}{isUnlocked ? ' (unlocked)' : ''}">
            <span
              class="relative grid size-14 place-items-center rounded-full border"
              style={isUnlocked
                ? `background:radial-gradient(circle at 35% 30%, ${GOLD}55, ${GOLD}14);border-color:${GOLD}88;color:${GOLD};box-shadow:0 0 14px ${GOLD}40`
                : "border-color:color-mix(in oklab, currentColor 12%, transparent);opacity:.45"}
            >
              <Icon icon={isUnlocked ? item.icon : "ic:outline-lock"} class="size-7" />
              {#if !isUnlocked && h.achievementProgress(item) > 0}
                <span class="absolute -bottom-1 left-2 right-2"><Bar value={h.achievementProgress(item) / item.target} height={3} label={item.title} /></span>
              {/if}
            </span>
            <span class="line-clamp-2 text-[10.5px] leading-tight {isUnlocked ? '' : 'opacity-60'}">{item.title}</span>
          </button>
        {/each}
      </div>
    {/each}
  </section>

  <!-- Settings -->
  {@render label("Daily goal & reading")}
  <section class="rounded-3xl border border-base-content/10 bg-base-200 p-4">
    <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {#each Object.entries(DAILY_GOALS) as [key, g]}
        <button
          class="rounded-2xl border p-3 text-left transition {h.goal === key ? 'border-primary bg-primary/10' : 'border-base-content/10 hover:bg-base-100/40'}"
          onclick={() => setDailyGoal(key)}
          aria-pressed={h.goal === key}
        >
          <span class="block text-sm font-semibold">{g.label}</span>
          <span class="block text-xs opacity-70">{g.xp} XP</span>
          <span class="block text-[10px] opacity-50">{g.hint}</span>
        </button>
      {/each}
    </div>
    <label class="mt-4 flex cursor-pointer items-center justify-between gap-3">
      <span>
        <span class="block text-sm font-medium">XP popups while reading</span>
        <span class="block text-xs opacity-60">Shows each XP award beside a small goal ring in the reader.</span>
      </span>
      <input type="checkbox" class="toggle toggle-primary" checked={h.readerHud} onchange={(e) => setReaderHud(e.currentTarget.checked)} />
    </label>
    <p class="mt-3 text-xs opacity-60">
      {h.freezes} of {MAX_FREEZES} streak freezes banked · earned every {FREEZE_EVERY_STREAK} streak days and used automatically. Reading reminders are available in the Android app.
    </p>
  </section>

  <p class="mt-6 px-1 text-[11px] leading-relaxed opacity-60">
    Pages earn 2 XP · chapters earn 25 XP · finishing all daily quests earns a {QUEST_BONUS_XP} XP bonus. Your flame tier multiplies XP (Flame +10%, Blaze +20%, Inferno +35%, Eternal +50%), and reading {FOCUS_MINUTES} minutes in one sitting enters focus for another +{FOCUS_BONUS_PCT}%. Meet your goal to unlock a daily mystery chest; reach 3×, 5× and 7× your goal in a week for bronze, silver and gold. A banked streak freeze bridges a missed day automatically. Missed more than you could cover? Earn {RESCUE_GOAL_MULTIPLIER}× your goal on the day you come back to rescue the streak.
  </p>
</main>

<dialog bind:this={chestDialog} class="modal" onclose={() => rewardDialogOpen.set(false)}>
  <div class="modal-box max-w-sm rounded-3xl text-center">
    {#if chestReward}
      {@const color = RARITY_COLORS[chestReward.rarity]}
      <Confetti colors={[color, GOLD, "#ffffff"]} />
      <div class="text-xs font-bold tracking-[0.2em]" style="color:{color}">{chestReward.rarity.toUpperCase()}</div>
      <Icon icon="ic:outline-inventory-2" class="mx-auto my-4 size-20" style="color:{color};filter:drop-shadow(0 0 18px {color})" />
      <div class="text-4xl font-semibold">+{chestReward.xp}</div>
      <div class="text-sm opacity-70">XP</div>
      {#if chestReward.freeze}
        <div class="mt-2 inline-flex items-center gap-1 text-sm font-semibold" style="color:{FROST}">
          <Icon icon="ic:round-ac-unit" class="size-4" /> +1 freeze
        </div>
      {/if}
      <button class="btn btn-primary mt-6 w-full rounded-full" onclick={() => closeReward(chestDialog)}>Collect</button>
    {:else}
      <Icon icon="ic:round-inventory-2" class="chest-ready mx-auto my-4 size-24" style="color:{GOLD};filter:drop-shadow(0 0 18px {GOLD})" />
      <p class="text-sm">You met your daily goal. Open the chest to see what's inside.</p>
      <p class="mt-1 text-xs opacity-60">A new chest appears every day you meet your goal.</p>
      <button class="btn btn-primary mt-6 w-full rounded-full" onclick={revealChest}>
        <Icon icon="ic:round-lock-open" class="size-5" /> Open chest
      </button>
    {/if}
  </div>
  <form method="dialog" class="modal-backdrop"><button onclick={(e) => { e.preventDefault(); closeReward(chestDialog); }}>close</button></form>
</dialog>

<dialog bind:this={weeklyDialog} class="modal" onclose={() => rewardDialogOpen.set(false)}>
  <div class="modal-box max-w-sm rounded-3xl text-center">
    {#if weeklyReward}
      <Confetti colors={[weeklyReward.color, GOLD, "#ffffff"]} />
      <Icon icon="ic:round-emoji-events" class="mx-auto mb-3 size-20" style="color:{weeklyReward.color};filter:drop-shadow(0 0 16px {weeklyReward.color})" />
      <div class="text-xs font-bold tracking-[0.2em]" style="color:{weeklyReward.color}">{weeklyReward.name.toUpperCase()} WEEK</div>
      <div class="mt-2 text-3xl font-semibold">+{weeklyReward.rewardXp} XP</div>
      {#if weeklyReward.freeze}
        <div class="mt-1 text-sm font-semibold" style="color:{FROST}">+1 streak freeze</div>
      {/if}
      <p class="mt-3 text-sm opacity-70">You earned {weeklyReward.multiplier}× your daily goal this week.</p>
    {/if}
    <button class="btn btn-primary mt-6 w-full rounded-full" onclick={() => closeReward(weeklyDialog)}>Collect</button>
  </div>
  <form method="dialog" class="modal-backdrop"><button onclick={(e) => { e.preventDefault(); closeReward(weeklyDialog); }}>close</button></form>
</dialog>

<dialog bind:this={badgeDialog} class="modal modal-bottom sm:modal-middle">
  <div class="modal-box rounded-t-3xl text-center sm:rounded-3xl">
    {#if badge}
      {@const isUnlocked = unlocked.has(badge.id)}
      {@const on = h.achievementUnlockedOn(badge.id)}
      {@const current = h.achievementProgress(badge)}
      <span
        class="mx-auto grid size-20 place-items-center rounded-full border"
        style={isUnlocked
          ? `background:radial-gradient(circle at 35% 30%, ${GOLD}55, ${GOLD}14);border-color:${GOLD}88;color:${GOLD};box-shadow:0 0 18px ${GOLD}55`
          : "border-color:color-mix(in oklab, currentColor 15%, transparent);opacity:.6"}
      >
        <Icon icon={badge.icon} class="size-10" />
      </span>
      <h3 class="mt-4 text-xl font-semibold">{badge.title}</h3>
      <p class="mt-1 text-sm opacity-70">{badge.description}</p>
      <div class="mt-4">
        {#if isUnlocked}
          <span class="badge gap-1 border-0" style="background:{SAGE}22;color:{SAGE}">
            <Icon icon="ic:round-verified" class="size-4" />{on ? `Unlocked ${shortDate(on)}` : "Unlocked"}
          </span>
        {:else}
          <Bar value={current / badge.target} height={8} label={badge.title} />
          <p class="mt-2 text-xs opacity-60">{fmtMetric(badge, current)} / {fmtMetric(badge, badge.target)}</p>
        {/if}
      </div>
      <p class="mt-2 text-[11px] opacity-50">{ACHIEVEMENT_CATEGORY_LABELS[badge.category]}</p>
    {/if}
    <form method="dialog"><button class="btn btn-ghost btn-sm mt-4">Close</button></form>
  </div>
  <form method="dialog" class="modal-backdrop"><button>close</button></form>
</dialog>

<style>
  :global(.chest-ready) {
    animation: chest-pulse 1.8s ease-in-out infinite;
  }
  @keyframes chest-pulse {
    0%,
    100% {
      box-shadow: 0 0 0 0 rgb(255 200 87 / 0);
    }
    50% {
      box-shadow: 0 0 0 6px rgb(255 200 87 / 0.18);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    :global(.chest-ready) {
      animation: none;
    }
  }
</style>
