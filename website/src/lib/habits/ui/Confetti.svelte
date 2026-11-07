<script lang="ts">
  import { onMount } from "svelte";
  import { prefersReducedMotion } from "./palette";

  let { colors = ["#ffc857", "#80bea4", "#b28dff", "#ff8a4c", "#9fd3ff"] }: { colors?: string[] } = $props();
  let canvas: HTMLCanvasElement;

  onMount(() => {
    if (prefersReducedMotion()) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
    };
    resize();
    const pieces = Array.from({ length: 120 }, () => ({
      x: canvas.width / 2 + (Math.random() - 0.5) * canvas.width * 0.2,
      y: canvas.height * 0.35,
      vx: (Math.random() - 0.5) * 14 * dpr,
      vy: (-Math.random() * 14 - 6) * dpr,
      size: (4 + Math.random() * 6) * dpr,
      spin: Math.random() * Math.PI,
      vs: (Math.random() - 0.5) * 0.3,
      color: colors[Math.floor(Math.random() * colors.length)],
    }));
    let frame = 0;
    let raf = 0;
    const tick = () => {
      frame++;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const p of pieces) {
        p.vy += 0.35 * dpr;
        p.vx *= 0.99;
        p.x += p.vx;
        p.y += p.vy;
        p.spin += p.vs;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.spin);
        ctx.globalAlpha = Math.max(0, 1 - frame / 160);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      }
      if (frame < 160) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  });
</script>

<canvas bind:this={canvas} class="pointer-events-none fixed inset-0 h-full w-full" aria-hidden="true"></canvas>
