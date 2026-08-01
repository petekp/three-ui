import { useEffect, useRef } from 'react'
import { createDomTextureSource, type DomTextureSource } from 'three-ui'

// Focus probe — not a lab. Empirical gate for docs/focus.md: can the
// browser's real focus machinery reach into parked source subtrees, can we
// intercept Tab at a boundary, and do visually-hidden ARIA proxies behave?
//
// Mount via URL: ?focusprobe=1
//
// No GL canvas: every question here is DOM-level. Two parked sources (the
// same createDomTextureSource Surfaces use), page-level focusables around
// them, and an opacity:0 proxy layer. Drive with REAL keys (CDP) — synthetic
// keydowns don't move focus — and read window.__focusProbe.state() between
// presses; the focusin log accumulates traversal order so a full Tab sweep
// needs one eval at the end, not one per press.
//
// Trial-flag evidence: state().paints — parked sources with paints > 0 mean
// paint records are live (the probe's analog of the HUD chip).

const SCROLL_BASE = 300

function parkedMarkup(id: string, hue: number) {
  return `
    <div style="width:320px;height:200px;box-sizing:border-box;padding:16px;
                font-family:ui-monospace,monospace;background:#0b1120;
                border:1px solid hsl(${hue} 60% 40%);border-radius:10px;
                color:#f8fafc;display:flex;flex-direction:column;gap:12px">
      <span style="font-size:12px;color:#94a3b8">PARKED ${id.toUpperCase()}</span>
      <button data-fid="${id}-btn" style="padding:8px 12px;border-radius:6px;
              border:1px solid #334155;background:#16233c;color:#f8fafc">
        button ${id}
      </button>
      <input data-fid="${id}-input" placeholder="field ${id}"
             style="padding:8px;border-radius:6px;border:1px solid #334155;
                    background:#0f172a;color:#f8fafc"/>
    </div>`
}

interface LogEntry {
  t: number
  type: string
  key?: string
  fid: string
  prevented?: boolean
  focusVisible?: boolean
}

function fidOf(el: EventTarget | null): string {
  if (!(el instanceof Element)) return 'none'
  const tagged = el.closest('[data-fid]')
  if (tagged) return tagged.getAttribute('data-fid')!
  if (el === document.body) return 'body'
  return el.tagName.toLowerCase()
}

export function ProbeFocusApp() {
  const sourcesRef = useRef<DomTextureSource[]>([])

  // The app shell pins html/body/#root to height:100%/overflow:hidden
  // (canvas app). The scroll-behavior probes need the WINDOW itself to be
  // scrollable — focus-autoscroll's canonical target — so unpin all three
  // (heights too, else #root becomes the scroller and window scroll stays 0).
  useEffect(() => {
    const els = [document.documentElement, document.body, document.getElementById('root')!]
    const prev = els.map((el) => ({ overflow: el.style.overflow, height: el.style.height }))
    els.forEach((el) => {
      el.style.overflow = 'visible'
      el.style.height = 'auto'
    })
    return () =>
      els.forEach((el, i) => {
        el.style.overflow = prev[i].overflow
        el.style.height = prev[i].height
      })
  }, [])

  useEffect(() => {
    const a = createDomTextureSource(parkedMarkup('a', 150), 320, 200, {
      label: 'focusprobe-a',
    })
    const b = createDomTextureSource(parkedMarkup('b', 270), 320, 200, {
      label: 'focusprobe-b',
    })
    sourcesRef.current = [a, b]

    let mode: 'observe' | 'intercept' = 'observe'
    const log: LogEntry[] = []
    const t0 = performance.now()
    const push = (e: Partial<LogEntry> & { type: string; fid: string }) =>
      log.push({ t: Math.round(performance.now() - t0), ...e })

    // Boundary interception under test: with focus on the designated LAST
    // tabbable (b-input) and Tab arriving, eat the native move and route to
    // the hop target — inside the keydown handler, exactly as production
    // will (identity check, not press counting — docs/focus.md tab hygiene).
    const onKeydown = (e: KeyboardEvent) => {
      const fid = fidOf(document.activeElement)
      if (
        mode === 'intercept' &&
        e.key === 'Tab' &&
        !e.shiftKey &&
        fid === 'b-input'
      ) {
        e.preventDefault()
        const hop = document.querySelector<HTMLElement>('[data-fid="page-before"]')
        hop?.focus({ preventScroll: true })
        push({
          type: 'intercept',
          key: 'Tab',
          fid,
          prevented: e.defaultPrevented,
          focusVisible: hop?.matches(':focus-visible') ?? false,
        })
        return
      }
      push({ type: 'keydown', key: e.key, fid, prevented: e.defaultPrevented })
    }
    const onFocusin = (e: FocusEvent) => {
      const el = e.target as Element
      push({
        type: 'focusin',
        fid: fidOf(el),
        focusVisible: el instanceof Element && el.matches(':focus-visible'),
      })
    }
    const onFocusout = (e: FocusEvent) => push({ type: 'focusout', fid: fidOf(e.target) })

    // The proxy contract: arrows are the control's keys — handled and
    // consumed (else the default action scrolls the page).
    const onProxyKeys = (e: KeyboardEvent) => {
      const fid = fidOf(e.target)
      if (!fid.startsWith('proxy-')) return
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
        e.preventDefault()
        push({ type: 'proxykey', key: e.key, fid, prevented: true })
      }
    }

    document.addEventListener('keydown', onKeydown, true)
    document.addEventListener('keydown', onProxyKeys, true)
    document.addEventListener('focusin', onFocusin, true)
    document.addEventListener('focusout', onFocusout, true)

    const probeStats = () =>
      Object.fromEntries(
        (window.__threeUI?.stats() ?? [])
          .filter((s) => s.label.startsWith('focusprobe-'))
          .map((s) => [s.label, s.paints]),
      )

    const harness = {
      arm: (m: 'observe' | 'intercept') => {
        mode = m
      },
      reset: () => {
        log.length = 0
        mode = 'observe'
        ;(document.activeElement as HTMLElement | null)?.blur?.()
        window.scrollTo(0, SCROLL_BASE)
      },
      state: () => ({
        active: fidOf(document.activeElement),
        focusVisible:
          document.activeElement instanceof Element &&
          document.activeElement.matches(':focus-visible'),
        scroll: [window.scrollX, window.scrollY] as [number, number],
        paints: probeStats(),
        log: [...log],
      }),
      focus: (fid: string, opts?: FocusOptions) => {
        const el = document.querySelector<HTMLElement>(`[data-fid="${fid}"]`)
        if (!el) return { ok: false }
        const before: [number, number] = [window.scrollX, window.scrollY]
        el.focus(opts)
        return {
          ok: true,
          before,
          after: [window.scrollX, window.scrollY] as [number, number],
          active: fidOf(document.activeElement),
          focusVisible: el.matches(':focus-visible'),
        }
      },
      mutateProxy: (times = 5) => {
        const el = document.querySelector<HTMLElement>('[data-fid="proxy-slider"]')
        for (let i = 0; i < times; i++) {
          el?.setAttribute('aria-valuenow', String(4 + ((i + 1) % 3)))
        }
        return probeStats()
      },
    }
    ;(window as unknown as { __focusProbe?: typeof harness }).__focusProbe = harness

    return () => {
      document.removeEventListener('keydown', onKeydown, true)
      document.removeEventListener('keydown', onProxyKeys, true)
      document.removeEventListener('focusin', onFocusin, true)
      document.removeEventListener('focusout', onFocusout, true)
      delete (window as unknown as { __focusProbe?: typeof harness }).__focusProbe
      a.dispose()
      b.dispose()
      sourcesRef.current = []
    }
  }, [])

  return (
    <div className="app" style={{ minHeight: '250vh' }}>
      <div className="hud">
        <h1>three-ui / focus probe</h1>
        <p className="sub">parked-subtree reachability · boundary interception · proxy contract</p>
        <button data-fid="page-before" style={{ margin: '8px 0' }}>
          page before
        </button>
      </div>

      {/* Proxy layer: the production shape — one fixed container adjacent to
          where the GL canvas would sit, pointer-events:none, children
          opacity:0 at fake "projected rects". */}
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 5 }}>
        <div
          data-fid="proxy-slider"
          role="slider"
          tabIndex={0}
          aria-label="Probe dial"
          aria-valuemin={0}
          aria-valuemax={10}
          aria-valuenow={4}
          style={{
            position: 'absolute',
            left: 300,
            top: 200,
            width: 120,
            height: 80,
            opacity: 0,
          }}
        />
        <button
          data-fid="proxy-off"
          style={{ position: 'fixed', left: '150vw', top: 40, opacity: 0 }}
        >
          offscreen proxy
        </button>
      </div>

      <div className="footer">
        <button data-fid="page-after">page after</button>
        <span style={{ marginLeft: 12 }}>
          __focusProbe.state() · .arm('intercept') · .focus(fid, opts) · .mutateProxy()
        </span>
      </div>
    </div>
  )
}
