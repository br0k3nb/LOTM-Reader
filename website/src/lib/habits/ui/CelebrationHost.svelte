<script lang="ts">
  // Big moments queued while reading (streak milestones and rescues, level
  // ups and Sequence advances, unlocked achievements), shown one dialog at a
  // time after leaving the reader, in the same order as the app.
  import { onMount } from "svelte";
  import Icon from "@iconify/svelte";
  import { celebrationQueue, rewardDialogOpen, startHabits } from "../store.svelte";
  import {
    SEQUENCE_NAMES,
    achievementById,
    levelCost,
    levelTitle,
    nextStreakMilestone,
    streakTier,
    type Achievement,
  } from "../constants";
  import Confetti from "./Confetti.svelte";
  import Flame from "./Flame.svelte";
  import Toasts from "./Toasts.svelte";
  import { GOLD, MYSTIC } from "./palette";

  type Moment =
    | { kind: "streak"; days: number; repaired: boolean }
    | { kind: "level"; level: number; sequence: number | null }
    | { kind: "achievements"; items: Achievement[] };

  let dialog: HTMLDialogElement;
  let current = $state<Moment | null>(null);
  let pending: Moment[] = [];

  let rewardOpen = false;
  let raw: string[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | undefined;

  /** Groups everything that arrived together, then shows the first moment. */
  function flush() {
    flushTimer = undefined;
    if (current || rewardOpen) return;
    pending.push(...group(raw));
    raw = [];
    next();
  }

  function scheduleFlush() {
    if (!flushTimer) flushTimer = setTimeout(flush, 120);
  }

  onMount(() => {
    startHabits();
    const stopQueue = celebrationQueue.subscribe((events) => {
      if (events.length === 0) return;
      celebrationQueue.set([]);
      raw.push(...events);
      scheduleFlush();
    });
    // Never cover a chest being opened: wait until reward dialogs close.
    const stopReward = rewardDialogOpen.subscribe((open) => {
      rewardOpen = open;
      if (!open) scheduleFlush();
    });
    return () => {
      stopQueue();
      stopReward();
      if (flushTimer) clearTimeout(flushTimer);
    };
  });

  function group(events: string[]): Moment[] {
    const moments: Moment[] = [];
    for (const event of events) {
      if (event.startsWith("streak:") || event.startsWith("repaired:")) {
        const days = Number(event.slice(event.indexOf(":") + 1));
        if (Number.isFinite(days)) moments.push({ kind: "streak", days, repaired: event.startsWith("repaired:") });
      }
    }
    let level: number | null = null;
    let sequence: number | null = null;
    const items: Achievement[] = [];
    for (const event of events) {
      const value = event.slice(event.indexOf(":") + 1);
      if (event.startsWith("level:")) {
        const n = Number(value);
        if (Number.isFinite(n) && (level === null || n > level)) level = n;
      } else if (event.startsWith("sequence:")) {
        const n = Number(value);
        if (Number.isFinite(n) && (sequence === null || n < sequence)) sequence = n;
      } else if (event.startsWith("achievement:")) {
        const item = achievementById(value);
        if (item && !items.includes(item)) items.push(item);
      }
    }
    if (level !== null) moments.push({ kind: "level", level, sequence });
    if (items.length > 0) moments.push({ kind: "achievements", items });
    return moments;
  }

  /** Closes this moment and shows the next; `close` may arrive later or not at all. */
  function dismiss() {
    dialog.close();
    next();
  }

  function next() {
    if (pending.length === 0 && raw.length > 0) {
      pending.push(...group(raw));
      raw = [];
    }
    current = pending.shift() ?? null;
    if (current) queueMicrotask(() => dialog?.open || dialog?.showModal());
    else dialog?.close();
  }
</script>

<dialog bind:this={dialog} class="modal" onclose={() => current && !dialog.open && next()}>
  {#if current}
    {#key current}
      <Confetti />
      <div class="modal-box max-w-sm rounded-3xl border border-base-content/10 text-center">
        {#if current.kind === "streak"}
          {@const tier = streakTier(current.days)}
          <div class="mx-auto mb-2 w-fit"><Flame color={tier.color} size={96} /></div>
          <div class="text-6xl font-light tabular-nums">{current.days}</div>
          <div class="mt-1 text-xs font-bold tracking-[0.2em]" style="color:{GOLD}">
            {current.repaired ? "STREAK RESCUED" : "DAY STREAK"}
          </div>
          <p class="mt-3 text-sm opacity-75">
            {current.repaired
              ? "You earned double your goal and brought your streak back to life."
              : current.days >= 365
                ? "A whole year of reading. The Mist bows to you."
                : `Milestone reached — your flame is now ${tier.name}. Next stop: ${nextStreakMilestone(current.days)} days.`}
          </p>
        {:else if current.kind === "level"}
          {@const ascended = current.sequence !== null}
          {@const accent = ascended ? MYSTIC : GOLD}
          <div
            class="mx-auto mb-4 grid size-24 place-items-center rounded-full text-4xl font-bold text-black"
            style="background:linear-gradient(135deg,{accent},color-mix(in oklab,{accent} 45%,#0b1116));box-shadow:0 0 24px {accent}77"
          >
            {current.level}
          </div>
          <div class="text-xs font-bold tracking-[0.2em]" style="color:{accent}">
            {ascended ? `SEQUENCE ${current.sequence} REACHED` : "LEVEL UP"}
          </div>
          <h3 class="mt-2 text-2xl font-semibold">
            {ascended ? SEQUENCE_NAMES[9 - (current.sequence ?? 9)] : `Level ${current.level} · ${levelTitle(current.level)}`}
          </h3>
          <p class="mt-3 text-sm opacity-75">
            {ascended
              ? `The potion is digested. You advanced along the pathway to Sequence ${current.sequence}: ${SEQUENCE_NAMES[9 - (current.sequence ?? 9)]}.`
              : `Every page brings you closer to the next Sequence. ${levelCost(current.level)} XP to Level ${current.level + 1}.`}
          </p>
        {:else}
          <div class="text-xs font-bold tracking-[0.2em]" style="color:{GOLD}">
            {current.items.length === 1 ? "ACHIEVEMENT UNLOCKED" : `${current.items.length} ACHIEVEMENTS UNLOCKED`}
          </div>
          <ul class="mt-4 max-h-80 space-y-3 overflow-y-auto text-left">
            {#each current.items as item}
              <li class="flex items-center gap-3 rounded-2xl bg-base-200 p-3">
                <span
                  class="grid size-11 shrink-0 place-items-center rounded-full"
                  style="background:{GOLD}22;color:{GOLD};box-shadow:0 0 12px {GOLD}44"
                >
                  <Icon icon={item.icon} class="size-6" />
                </span>
                <span>
                  <span class="block font-semibold">{item.title}</span>
                  <span class="block text-xs opacity-70">{item.description}</span>
                </span>
              </li>
            {/each}
          </ul>
        {/if}
        <button class="btn btn-primary mt-6 w-full rounded-full" onclick={dismiss}>Keep reading</button>
      </div>
    {/key}
  {/if}
  <form method="dialog" class="modal-backdrop"><button onclick={(e) => { e.preventDefault(); dismiss(); }}>close</button></form>
</dialog>
<Toasts />
