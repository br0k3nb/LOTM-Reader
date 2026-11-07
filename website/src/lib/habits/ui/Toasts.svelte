<script lang="ts">
  import Icon from "@iconify/svelte";
  import { fly } from "svelte/transition";
  import { habitToasts } from "../store.svelte";
  import { TONES } from "./palette";

  let { bottom = 24 }: { bottom?: number } = $props();
</script>

<div
  class="pointer-events-none fixed left-1/2 z-[60] flex w-[min(92vw,420px)] -translate-x-1/2 flex-col gap-2"
  style="bottom:{bottom}px"
  aria-live="polite"
>
  {#each $habitToasts as t (t.id)}
    <div
      transition:fly={{ y: 16, duration: 220 }}
      class="pointer-events-auto flex items-center gap-3 rounded-2xl border bg-base-100/95 px-4 py-3 text-sm font-medium shadow-xl backdrop-blur"
      style="border-color:{TONES[t.tone]}55"
    >
      <span style="color:{TONES[t.tone]}"><Icon icon={t.icon} class="size-5" /></span>
      <span>{t.text}</span>
    </div>
  {/each}
</div>
