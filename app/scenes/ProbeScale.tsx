import { useEffect, useMemo, useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import { Surface } from 'three-ui'

// Scale probe — not a lab. Answers one question: how many live Surfaces can
// the DOM→canvas→texture pipeline carry before frame time dies?
//
// Mount via URL:  ?probe=N          N static Surfaces (no DOM mutations)
//                 ?probe=N&live=1   every source mutated every frame
//                 &anim=K           only the first K sources mutate
//                 &w=640&h=400      per-card DOM/texture size (default 320×200)
//
// Note the current Surface contract makes "static" a pipeline measurement,
// not a free ride: useFrame calls repaint() + texture.needsUpdate every
// frame unconditionally, so N static Surfaces still pay N rasterizes and N
// full texture uploads per frame. If static ≈ live in the results, that's
// the case for dirty-tracking.
//
// Harness: window.__probe.ready() → all N sources have painted at least
// once; window.__probe.run(seconds) → Promise of frame-time percentiles
// (rAF deltas) + per-source paint rates from the __threeUI registry (the
// min reveals compositor starvation of occluded parked canvases).

function cardMarkup(i: number, w: number, h: number) {
  const hue = (i * 47) % 360
  return `
    <div style="width:${w}px;height:${h}px;box-sizing:border-box;padding:18px;
                font-family:ui-monospace,monospace;background:#0b1120;
                border:1px solid hsl(${hue} 60% 40%);border-radius:10px;color:#f8fafc;
                display:flex;flex-direction:column;gap:10px">
      <div style="display:flex;justify-content:space-between;font-size:12px;color:#94a3b8">
        <span>SURFACE ${String(i).padStart(2, '0')}</span>
        <span style="color:hsl(${hue} 70% 60%)">●</span>
      </div>
      <div data-tick style="font-size:44px;font-weight:700;line-height:1">0</div>
      <div style="height:10px;border-radius:5px;background:#16233c;overflow:hidden">
        <div data-bar style="width:0%;height:100%;background:hsl(${hue} 70% 55%)"></div>
      </div>
    </div>`
}

interface ProbeResult {
  n: number
  live: boolean
  anim: number
  cardW: number
  cardH: number
  seconds: number
  frames: number
  fps: number
  frameMs: { mean: number; p50: number; p95: number; p99: number; max: number }
  over17: number
  over34: number
  paintsPerSec: { min: number; mean: number; max: number }
}

interface CardRefs {
  tick: HTMLElement
  bar: HTMLElement
}

function usePercentiles() {
  return useMemo(
    () => (sorted: number[], p: number) =>
      sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))],
    [],
  )
}

export interface ProbeConfig {
  n: number
  live: boolean
  anim: number
  cardW: number
  cardH: number
}

export function ProbeScaleApp({ n, live, anim, cardW, cardH }: ProbeConfig) {
  const animCount = live ? n : Math.min(anim, n)
  const cards = useRef<Map<number, CardRefs>>(new Map())
  const pct = usePercentiles()

  const w3 = cardW / 200
  const h3 = cardH / 200
  const spX = w3 + 0.18
  const spY = h3 + 0.18

  const { positions, dist } = useMemo(() => {
    const cols = Math.ceil(Math.sqrt(n))
    const rows = Math.ceil(n / cols)
    const positions = Array.from({ length: n }, (_, i) => {
      const c = i % cols
      const r = Math.floor(i / cols)
      return [
        (c - (cols - 1) / 2) * spX,
        ((rows - 1) / 2 - r) * spY,
        0,
      ] as [number, number, number]
    })
    const halfFov = (45 / 2) * (Math.PI / 180)
    const dist =
      Math.max(rows * spY, (cols * spX) / 1.7) / 2 / Math.tan(halfFov) + 1.4
    return { positions, dist }
  }, [n, spX, spY])

  // Live mode: mutate every source every frame (text + bar width). Element
  // lookups are cached at onSource time so the mutation itself stays cheap
  // and uniform — we're measuring the paint pipeline, not querySelector.
  useEffect(() => {
    if (animCount === 0) return
    let raf = 0
    let t0 = -1
    const loop = (now: number) => {
      if (t0 < 0) t0 = now
      const t = Math.floor(now - t0)
      cards.current.forEach(({ tick, bar }, i) => {
        if (i >= animCount) return
        tick.textContent = String(t)
        bar.style.width = `${((t / 12 + i * 7) % 100).toFixed(1)}%`
      })
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [animCount])

  useEffect(() => {
    const probeStats = () =>
      (window.__threeUI?.stats() ?? []).filter((s) => s.label.startsWith('probe-'))

    const harness = {
      n,
      live,
      anim: animCount,
      cardW,
      cardH,
      ready: () => {
        const ps = probeStats()
        return ps.length === n && ps.every((s) => s.paints > 0)
      },
      run: (seconds = 5) =>
        new Promise<ProbeResult>((resolve) => {
          const paints0 = new Map(probeStats().map((s) => [s.label, s.paints]))
          const deltas: number[] = []
          let last = -1
          let t0 = -1
          const loop = (now: number) => {
            if (t0 < 0) t0 = now
            if (last >= 0) deltas.push(now - last)
            last = now
            if (now - t0 < seconds * 1000) {
              requestAnimationFrame(loop)
              return
            }
            const elapsed = (now - t0) / 1000
            const sorted = [...deltas].sort((a, b) => a - b)
            const rates = probeStats().map(
              (s) => (s.paints - (paints0.get(s.label) ?? 0)) / elapsed,
            )
            resolve({
              n,
              live,
              anim: animCount,
              cardW,
              cardH,
              seconds: elapsed,
              frames: deltas.length,
              fps: deltas.length / elapsed,
              frameMs: {
                mean: deltas.reduce((a, b) => a + b, 0) / deltas.length,
                p50: pct(sorted, 0.5),
                p95: pct(sorted, 0.95),
                p99: pct(sorted, 0.99),
                max: sorted[sorted.length - 1],
              },
              over17: deltas.filter((d) => d > 17).length / deltas.length,
              over34: deltas.filter((d) => d > 34).length / deltas.length,
              paintsPerSec: {
                min: Math.min(...rates),
                mean: rates.reduce((a, b) => a + b, 0) / rates.length,
                max: Math.max(...rates),
              },
            })
          }
          requestAnimationFrame(loop)
        }),
    }
    ;(window as unknown as { __probe?: typeof harness }).__probe = harness
    return () => {
      delete (window as unknown as { __probe?: typeof harness }).__probe
    }
  }, [n, live, animCount, cardW, cardH, pct])

  return (
    <div className="app">
      <Canvas camera={{ position: [0, 0, dist], fov: 45 }} dpr={[1, 2]}>
        <ambientLight intensity={0.9} />
        <directionalLight position={[4, 6, 8]} intensity={1.1} />
        {positions.map((position, i) => (
          <Surface
            key={i}
            label={`probe-${i}`}
            html={cardMarkup(i, cardW, cardH)}
            width={cardW}
            height={cardH}
            position={position}
            onSource={(el) => {
              const tick = el.querySelector('[data-tick]') as HTMLElement
              const bar = el.querySelector('[data-bar]') as HTMLElement
              cards.current.set(i, { tick, bar })
              return () => {
                cards.current.delete(i)
              }
            }}
          >
            <planeGeometry args={[w3, h3]} />
          </Surface>
        ))}
      </Canvas>
      <div className="hud">
        <h1>three-ui / scale probe</h1>
        <p className="sub">
          {n} Surfaces · {animCount === 0 ? 'static' : `${animCount} mutating every frame`} ·{' '}
          {cardW}×{cardH}px each
        </p>
      </div>
      <div className="footer">
        await __probe.run(5) → frame-time percentiles + per-source paint rates
      </div>
    </div>
  )
}
