<script lang="ts">
  import Icon from "@iconify/svelte";

  let {
    color,
    size = 28,
    lit = true,
    outlined = false,
    animate = true,
  }: { color: string; size?: number; lit?: boolean; outlined?: boolean; animate?: boolean } = $props();
</script>

<span
  class="flame inline-grid place-items-center {lit && animate ? 'flicker' : ''}"
  style="color:{lit ? color : 'color-mix(in oklab, currentColor 35%, transparent)'};{lit
    ? `filter: drop-shadow(0 0 ${Math.round(size / 5)}px ${color}88)`
    : ''}"
  aria-hidden="true"
>
  <Icon
    icon={outlined ? "ic:outline-local-fire-department" : "ic:round-local-fire-department"}
    width={size}
    height={size}
  />
</span>

<style>
  .flicker {
    animation: flicker 2.4s ease-in-out infinite;
    transform-origin: 50% 85%;
  }
  @keyframes flicker {
    0%,
    100% {
      transform: scale(1) rotate(0deg);
    }
    30% {
      transform: scale(1.06, 0.97) rotate(-2deg);
    }
    60% {
      transform: scale(0.97, 1.05) rotate(2deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .flicker {
      animation: none;
    }
  }
</style>
