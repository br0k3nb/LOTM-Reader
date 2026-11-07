<script lang="ts">
  import type { Snippet } from "svelte";
  import { GOLD } from "./palette";

  let {
    value = 0,
    size = 92,
    stroke = 8,
    color = GOLD,
    track = "color-mix(in oklab, currentColor 12%, transparent)",
    label = "Progress",
    children,
  }: {
    value?: number;
    size?: number;
    stroke?: number;
    color?: string;
    track?: string;
    label?: string;
    children?: Snippet;
  } = $props();

  const radius = $derived((size - stroke) / 2);
  const circumference = $derived(2 * Math.PI * radius);
  const offset = $derived(circumference * (1 - Math.min(1, Math.max(0, value))));
</script>

<div
  class="relative inline-grid place-items-center shrink-0"
  style="width:{size}px;height:{size}px"
  role="progressbar"
  aria-label={label}
  aria-valuemin="0"
  aria-valuemax="100"
  aria-valuenow={Math.round(Math.min(1, Math.max(0, value)) * 100)}
>
  <svg width={size} height={size} class="-rotate-90 absolute inset-0" aria-hidden="true">
    <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={track} stroke-width={stroke} />
    <circle
      cx={size / 2}
      cy={size / 2}
      r={radius}
      fill="none"
      stroke={color}
      stroke-width={stroke}
      stroke-linecap="round"
      stroke-dasharray={circumference}
      stroke-dashoffset={offset}
      class="ring-arc"
      style="filter: drop-shadow(0 0 6px {color}66)"
    />
  </svg>
  <div class="relative flex flex-col items-center justify-center leading-none">
    {@render children?.()}
  </div>
</div>

<style>
  .ring-arc {
    transition: stroke-dashoffset 700ms cubic-bezier(0.22, 1, 0.36, 1);
  }
  @media (prefers-reduced-motion: reduce) {
    .ring-arc {
      transition: none;
    }
  }
</style>
