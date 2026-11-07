<script lang="ts">
  import { onMount } from "svelte";
  import { habitView, startHabits } from "../store.svelte";
  import { streakTier } from "../constants";
  import Flame from "./Flame.svelte";
  import { GOLD } from "./palette";

  let { compact = false }: { compact?: boolean } = $props();

  onMount(() => startHabits());

  const view = $derived($habitView);
  const now = $derived.by(() => (view.version, new Date()));
  const streak = $derived(view.engine.currentStreak(now));
  const tier = $derived(streakTier(streak));
  const active = $derived(view.engine.activeOn(now));
  const waiting = $derived(view.engine.rewardsWaiting(now));
</script>

<a
  href="/progress/"
  class="btn btn-ghost btn-sm relative gap-1 rounded-btn px-2"
  aria-label="Reading progress: {streak}-day streak{waiting > 0 ? `, ${waiting} rewards ready` : ''}"
  title="{streak}-day streak · {view.engine.todayXp(now)}/{view.engine.goalTargetXp} XP today"
>
  <Flame color={tier.color} size={22} lit={streak > 0} outlined={!active && streak > 0} animate={false} />
  <span class="font-bold tabular-nums">{streak}</span>
  {#if !compact}
    <span class="hidden text-xs opacity-60 sm:inline">
      {view.engine.todayXp(now)}/{view.engine.goalTargetXp} XP
    </span>
  {/if}
  {#if waiting > 0}
    <span class="absolute right-0.5 top-0.5 size-2.5 rounded-full" style="background:{GOLD};box-shadow:0 0 6px {GOLD}"></span>
  {/if}
</a>
