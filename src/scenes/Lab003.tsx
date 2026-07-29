import { useRef, useState } from 'react'
import { Text } from '@react-three/drei'
import { Surface } from '../primitives/Surface'

// Lab 003 — feasibility edges of the primitive set:
//   A. multi-Surface   several live source canvases parked at the same fixed
//                      position (occluding each other) — do they all paint?
//                      Evidence: window.__threeUI.stats() paint counters.
//   B. popover Surface a custom select whose dropdown is a SECOND Surface
//                      floating in front of the panel — retires nudgeSelect.
//
// State philosophy: React state only decides what exists in the scene
// (popover open/closed). Interaction state lives in the DOM itself — the
// hidden input holds the committed value, labels/status are mutated
// directly, so no texture source is ever torn down by a re-render.

const PX_PER_UNIT = 200

const PANEL_W = 640
const PANEL_H = 400
const PANEL_W3 = PANEL_W / PX_PER_UNIT
const PANEL_H3 = PANEL_H / PX_PER_UNIT

const POP_W = 340
const POP_H = 264
const POP_W3 = POP_W / PX_PER_UNIT
const POP_H3 = POP_H / PX_PER_UNIT

const MODES = ['cruise', 'slingshot', 'drift', 'silent run']

function panelMarkup() {
  return `
    <div style="width:${PANEL_W}px;height:${PANEL_H}px;box-sizing:border-box;padding:32px 36px;
                font-family:system-ui,sans-serif;background:linear-gradient(165deg,#0b1120,#0f1a30);
                color:#f8fafc;" data-mode-root>
      <style>
        .nav { display:flex; flex-direction:column; gap:16px; }
        .nav input[type=text] { padding:13px 14px; border-radius:8px; border:1px solid #2b3b55;
          background:#16233c; color:#f8fafc; font-size:15px; outline:none; width:100%; box-sizing:border-box; }
        .nav input[type=text]:hover { border-color:#3b82f6; }
        .nav input[type=text]:focus { border-color:#38bdf8; box-shadow:0 0 0 3px rgba(56,189,248,.25); }
        .nav .trigger { display:flex; justify-content:space-between; align-items:center;
          padding:13px 14px; border-radius:8px; border:1px solid #2b3b55; background:#16233c;
          color:#f8fafc; font-size:15px; cursor:pointer; width:100%; box-sizing:border-box; text-align:left; }
        .nav .trigger:hover { border-color:#3b82f6; }
        .nav .trigger[aria-expanded=true] { border-color:#38bdf8; box-shadow:0 0 0 3px rgba(56,189,248,.25); }
        .nav .trigger .chev { color:#7dd3fc; transition:transform .15s; }
        .nav .trigger[aria-expanded=true] .chev { transform:rotate(180deg); }
      </style>
      <div class="nav">
        <strong style="font-size:24px;letter-spacing:-0.02em">Nav console</strong>
        <span style="font-size:13px;color:#7dd3fc">the mode picker opens a second Surface — no native dropdown involved</span>
        <input type="text" name="callsign" placeholder="callsign" autocomplete="off" />
        <input type="hidden" name="mode" value="${MODES[0]}" />
        <button type="button" name="mode-trigger" class="trigger" aria-haspopup="listbox" aria-expanded="false">
          <span data-mode-label>${MODES[0]}</span><span class="chev">&#9662;</span>
        </button>
        <span data-status style="font-size:12px;color:#64748b;font-family:ui-monospace,monospace">mode: ${MODES[0]}</span>
      </div>
    </div>`
}

function popoverMarkup(current: string) {
  const items = MODES.map(
    (m) => `
      <button type="button" role="option" data-option="${m}" aria-selected="${m === current}">
        ${m}${m === current ? '<span style="color:#38bdf8">&#10003;</span>' : ''}
      </button>`,
  ).join('')
  return `
    <div style="width:${POP_W}px;height:${POP_H}px;box-sizing:border-box;padding:10px;
                font-family:system-ui,sans-serif;background:#101b33;border:1px solid #2b3b55;
                border-radius:12px;" role="listbox" aria-label="mode">
      <style>
        .pop { display:flex; flex-direction:column; gap:4px; }
        .pop button { display:flex; justify-content:space-between; align-items:center;
          padding:13px 14px; border-radius:8px; border:0; background:transparent; color:#f8fafc;
          font-size:15px; cursor:pointer; text-align:left; }
        .pop button:hover { background:#1d2b47; }
        .pop button[aria-selected=true] { background:#16233c; }
      </style>
      <div class="pop">${items}</div>
    </div>`
}

interface PopoverState {
  /** Panel-local position for the popover center (world units). */
  x: number
  y: number
  current: string
}

export function Lab003() {
  const navRoot = useRef<HTMLElement | null>(null)
  const [popover, setPopover] = useState<PopoverState | null>(null)

  const setExpanded = (open: boolean) => {
    navRoot.current
      ?.querySelector('[name=mode-trigger]')
      ?.setAttribute('aria-expanded', String(open))
  }

  const commitMode = (mode: string) => {
    const el = navRoot.current
    if (!el) return
    ;(el.querySelector('[name=mode]') as HTMLInputElement).value = mode
    el.querySelector('[data-mode-label]')!.textContent = mode
    el.querySelector('[data-status]')!.textContent = `mode: ${mode}`
    setExpanded(false)
    setPopover(null)
  }

  const wireNav = (el: HTMLElement) => {
    navRoot.current = el
    const onClick = (ev: Event) => {
      const trigger = (ev.target as Element).closest('[name=mode-trigger]')
      if (!trigger) {
        // Click anywhere else on the panel dismisses the popover.
        setExpanded(false)
        setPopover(null)
        return
      }
      // Anchor the popover under the trigger: DOM rect → panel-local units.
      const rootRect = el.getBoundingClientRect()
      const r = trigger.getBoundingClientRect()
      const cx = (r.left + r.right) / 2 - rootRect.left
      const bottom = r.bottom - rootRect.top
      const x = (cx / PANEL_W - 0.5) * PANEL_W3
      const y = (0.5 - bottom / PANEL_H) * PANEL_H3 - POP_H3 / 2 - 0.05
      const current = (el.querySelector('[name=mode]') as HTMLInputElement).value
      setPopover((p) => {
        setExpanded(!p)
        return p ? null : { x, y, current }
      })
    }
    el.addEventListener('click', onClick)
    return () => {
      el.removeEventListener('click', onClick)
      navRoot.current = null
    }
  }

  const wirePopover = (el: HTMLElement) => {
    const onClick = (ev: Event) => {
      const option = (ev.target as Element).closest('[data-option]')
      if (option) commitMode((option as HTMLElement).dataset.option!)
    }
    el.addEventListener('click', onClick)
    return () => el.removeEventListener('click', onClick)
  }

  return (
    <>
      <ambientLight intensity={0.4} />
      <directionalLight position={[5, 8, 5]} intensity={1.4} castShadow />
      <pointLight position={[-4, 3, 4]} intensity={30} color="#93c5fd" />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.16, 0]} receiveShadow>
        <planeGeometry args={[40, 40]} />
        <meshStandardMaterial color="#111318" roughness={0.95} />
      </mesh>

      {/* Station A — nav panel + popover-as-second-Surface */}
      <group position={[-1.6, 2.0, 0]} rotation={[0, 0.28, 0]}>
        <Surface
          label="lab003-nav"
          html={panelMarkup()}
          width={PANEL_W}
          height={PANEL_H}
          onSource={wireNav}
          castShadow
        >
          <planeGeometry args={[PANEL_W3, PANEL_H3]} />
        </Surface>

        {popover && (
          <Surface
            label="lab003-popover"
            html={popoverMarkup(popover.current)}
            width={POP_W}
            height={POP_H}
            position={[popover.x, popover.y, 0.3]}
            onSource={wirePopover}
            castShadow
          >
            <planeGeometry args={[POP_W3, POP_H3]} />
          </Surface>
        )}

        <Text position={[0, -1.35, 0]} fontSize={0.13} color="#94a3b8" anchorX="center">
          popover = a second {'<Surface />'} floating off the panel
        </Text>
      </group>

      {/* Station C readout — a coexisting Surface (knob will write here) */}
      <group position={[2.4, 1.4, 0.6]} rotation={[0, -0.35, 0]}>
        <Surface
          label="lab003-readout"
          html={readoutMarkup()}
          width={READOUT_W}
          height={READOUT_H}
          castShadow
        >
          <planeGeometry args={[READOUT_W3, READOUT_H3]} />
        </Surface>
      </group>
    </>
  )
}

const READOUT_W = 320
const READOUT_H = 180
const READOUT_W3 = READOUT_W / PX_PER_UNIT
const READOUT_H3 = READOUT_H / PX_PER_UNIT

function readoutMarkup() {
  const cells = Array.from(
    { length: 8 },
    (_, i) =>
      `<span data-cell="${i}" style="flex:1;height:14px;border-radius:3px;
         background:${i < 4 ? '#38bdf8' : '#1d2b47'}"></span>`,
  ).join('')
  return `
    <div style="width:${READOUT_W}px;height:${READOUT_H}px;box-sizing:border-box;padding:20px 22px;
                font-family:ui-monospace,monospace;background:#0b1120;border:1px solid #1d2b47;
                border-radius:10px;color:#f8fafc;display:flex;flex-direction:column;gap:10px;">
      <span style="font-size:12px;color:#7dd3fc;letter-spacing:.08em">THRUST</span>
      <span style="font-size:44px;font-weight:700;line-height:1"><span data-detent>4</span><span style="font-size:16px;color:#64748b"> / 7</span></span>
      <div style="display:flex;gap:5px">${cells}</div>
    </div>`
}
