<script lang="ts">
  // In-reader HUD (the app's ReaderXpHud): each XP award floats up beside a
  // small goal ring with the active multiplier, then fades. Toggle on the
  // Progress page ("XP popups while reading").
  import { onDestroy } from "svelte";
  import Icon from "@iconify/svelte";
  import { fly, fade } from "svelte/transition";
  import { habitView, xpGains } from "../store.svelte";
  import { streakTier } from "../constants";
  import Ring from "./Ring.svelte";
  import Toasts from "./Toasts.svelte";
  import { GOLD, MYSTIC, SAGE } from "./palette";

  type Floating = { id: number; text: string; sub: string; chapter: boolean };
  let floating = $state<Floating[]>([]);
  let visible = $state(false);
  let hideTimer: ReturnType<typeof setTimeout> | undefined;

  const view = $derived($habitView);
  const now = $derived.by(() => (view.version, new Date()));
  const enabled = $derived(view.engine.readerHud);
  const todayXp = $derived(view.engine.todayXp(now));
  const target = $derived(view.engine.goalTargetXp);
  const met = $derived(todayXp >= target);
  const streak = $derived(view.engine.currentStreak(now));
  const session = $derived(view.engine.session(now));

  const unsubscribe = xpGains.subscribe((gain) => {
    if (!gain || Date.now() - gain.at > 5_000) return;
    const item: Floating = {
      id: gain.id,
      text: `+${gain.xp} XP`,
      sub: gain.chapter ? "Chapter complete" : gain.bonusPct > 0 ? `×${(1 + gain.bonusPct / 100).toFixed(2)}` : "",
      chapter: gain.chapter,
    };
    floating = [...floating.slice(-2), item];
    setTimeout(() => (floating = floating.filter((f) => f.id !== item.id)), 1_800);
    visible = true;
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => (visible = false), 4_000);
  });

  onDestroy(() => {
    unsubscribe();
    if (hideTimer) clearTimeout(hideTimer);
  });
</script>

{#if enabled}
  <div class="pointer-events-none fixed bottom-5 right-4 z-[55] flex flex-col items-end gap-1.5">
    {#each floating as f (f.id)}
      <div
        in:fly={{ y: 18, duration: 260 }}
        out:fade={{ duration: 400 }}
        class="rounded-full border bg-base-100/90 px-3 py-1 text-sm font-bold shadow-lg backdrop-blur"
        style="color:{f.chapter ? SAGE : GOLD};border-color:{f.chapter ? SAGE : GOLD}55"
      >
        {f.text}
        {#if f.sub}<span class="ml-1 text-xs font-semibold opacity-75">{f.sub}</span>{/if}
      </div>
    {/each}
    {#if visible}
      <a
        href="/progress/"
        transition:fade={{ duration: 300 }}
        class="pointer-events-auto flex items-center gap-2 rounded-full border border-base-content/10 bg-base-100/90 py-1 pl-1 pr-3 shadow-lg backdrop-blur"
        aria-label="Open reading progress"
      >
        <Ring value={todayXp / target} size={38} stroke={4} color={met ? SAGE : GOLD} label="Daily goal">
          {#if met}
            <Icon icon="ic:round-check" class="size-4" style="color:{SAGE}" />
          {:else}
            <span class="text-[10px] font-bold tabular-nums">{todayXp}</span>
          {/if}
        </Ring>
        <span class="flex flex-col text-xs leading-tight">
          <span class="font-semibold">{todayXp}/{target} XP</span>
          <span class="flex items-center gap-1 opacity-70">
            <Icon icon="ic:round-local-fire-department" class="size-3.5" style="color:{streakTier(streak).color}" />
            {streak}
            {#if session?.focus}
              <span class="font-semibold" style="color:{MYSTIC}">· focus</span>
            {/if}
          </span>
        </span>
      </a>
    {/if}
  </div>
{/if}
<Toasts bottom={84} />
