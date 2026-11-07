<script lang="ts">
  import { GOLD } from "./palette";

  let {
    value = 0,
    height = 8,
    from = `${GOLD}99`,
    to = GOLD,
    markers = [] as number[],
    shimmer = false,
    label = "Progress",
  }: {
    value?: number;
    height?: number;
    from?: string;
    to?: string;
    markers?: number[];
    shimmer?: boolean;
    label?: string;
  } = $props();

  const pct = $derived(Math.round(Math.min(1, Math.max(0, value)) * 1000) / 10);
</script>

<div
  class="relative w-full overflow-hidden rounded-full bg-base-content/10"
  style="height:{height}px"
  role="progressbar"
  aria-label={label}
  aria-valuemin="0"
  aria-valuemax="100"
  aria-valuenow={Math.round(pct)}
>
  <div
    class="bar-fill h-full rounded-full {shimmer ? 'shimmer' : ''}"
    style="width:{pct}%;background:linear-gradient(90deg,{from},{to});box-shadow:0 0 10px {to}55"
  ></div>
  {#each markers as m}
    <span class="absolute top-0 h-full w-px bg-base-100/70" style="left:{m * 100}%"></span>
  {/each}
</div>

<style>
  .bar-fill {
    transition: width 700ms cubic-bezier(0.22, 1, 0.36, 1);
    position: relative;
  }
  .shimmer::after {
    content: "";
    position: absolute;
    inset: 0;
    background: linear-gradient(100deg, transparent 20%, rgb(255 255 255 / 0.35) 50%, transparent 80%);
    animation: sheen 2.2s ease-in-out infinite;
  }
  @keyframes sheen {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(100%);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .bar-fill {
      transition: none;
    }
    .shimmer::after {
      animation: none;
    }
  }
</style>
