// Lab 006 content: the workspace panels. Markup is authored in the Surface
// dialect (docs/authoring.md):
//   - pulses are PAINT properties only — background-color transitions on the
//     panel root ([data-fresh]), never opacity/transform
//   - every :hover/:active has a [data-hover]/[data-active] twin (synthetic
//     events can't flip pseudo-classes)
//   - feeds mutate burst-y (one coalesced write per tick), then go quiescent,
//     so each panel stays inside the free-idle contract between updates
//
// A panel spec is markup plus an optional `feed(root)` — attached via
// Surface's onSource — that owns its timers and returns cleanup.

/** A satellite WebGL dial that joins the panel's focus group as a LEAF
 *  member — physical matter in the same Tab traversal as the panel's DOM. */
export interface DialSpec {
  label: string
  detents: number
  initialDetent: number
  /** aria-valuetext + the panel's readout strings, by detent index. */
  values: string[]
}

export interface PanelSpec {
  id: string
  html: string
  feed?: (root: HTMLElement) => () => void
  dial?: DialSpec
}

export const PANEL_W = 420
export const PANEL_H = 300

// ---------------------------------------------------------------------------
// Shared stylesheet. The parked subtrees are real in-document DOM, so one
// injected sheet covers every panel; classes keep the markup strings sane.

const STYLE_ID = 'lab006-css'

const CSS = `
.p6{box-sizing:border-box;width:${PANEL_W}px;height:${PANEL_H}px;padding:16px 18px;
  font-family:-apple-system,ui-sans-serif,'Helvetica Neue',sans-serif;
  background:#0d1526;border:1px solid #1e2b45;border-radius:14px;color:#e2e8f0;
  display:flex;flex-direction:column;gap:10px;overflow:hidden;
  transition:background-color .45s,border-color .45s}
.p6[data-fresh="1"]{background:#1c2c50;border-color:#3b5385}
.p6 h2{margin:0;font-size:12px;letter-spacing:.14em;color:#7dd3fc;font-weight:600;
  text-transform:uppercase;display:flex;justify-content:space-between;align-items:baseline}
.p6 .tag{font-size:10px;letter-spacing:.05em;color:#475569;text-transform:none}
.p6 p{margin:0;font-size:13.5px;line-height:1.6;color:#94a3b8}
.p6 .fill{flex:1;min-height:0}
.p6-btn{font:inherit;font-size:13px;padding:7px 14px;border-radius:8px;cursor:pointer;
  border:1px solid #2b3d63;background:#152036;color:#dbeafe;transition:background-color .15s}
.p6-btn:hover,.p6-btn[data-hover]{background:#1d2c4d;border-color:#3b5385}
.p6-btn:active,.p6-btn[data-active]{background:#0f1830}
.p6-btn[data-selected="1"]{background:#0ea5e9;border-color:#38bdf8;color:#04121f;font-weight:600}
.p6-btn.primary{background:#0ea5e9;border-color:#38bdf8;color:#04121f;font-weight:600}
.p6-btn.primary:hover,.p6-btn.primary[data-hover]{background:#38bdf8}
.p6-field{font:inherit;font-size:13px;background:#0a1120;border:1px solid #223354;
  border-radius:8px;color:#f1f5f9;padding:7px 10px;outline:none;min-width:0}
.p6-field:focus{border-color:#38bdf8;box-shadow:0 0 0 2px rgba(56,189,248,.28)}
.p6 [contenteditable]{outline:none;font-size:13.5px;line-height:1.7;color:#cbd5e1}
.p6 [contenteditable]:focus{color:#f8fafc}
.p6 .line{font-family:ui-monospace,monospace;font-size:11.5px;line-height:1.5;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#7d8db1}
.p6 .line b{font-weight:600}
.p6 .err b{color:#f87171}.p6 .warn b{color:#fbbf24}.p6 .ok b{color:#34d399}
.p6 .dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:9px;
  background:#233252;transition:background-color .3s,box-shadow .3s}
.p6 .dot[data-state="done"]{background:#34d399}
.p6 .dot[data-state="run"]{background:#fbbf24;box-shadow:0 0 8px #fbbf24}
.p6 .dot[data-state="fail"]{background:#f87171}
.p6 .step{display:flex;align-items:center;font-size:13px;color:#94a3b8;padding:3px 0}
.p6 .step .t{margin-left:auto;font-size:11px;color:#475569;font-family:ui-monospace,monospace}
.p6 .bars{display:flex;align-items:flex-end;gap:4px;height:64px}
.p6 .bars span{flex:1;background:linear-gradient(180deg,#38bdf8,#0ea5e9);border-radius:3px 3px 0 0}
.p6 .big{font-size:34px;font-weight:700;color:#f8fafc;line-height:1}
.p6 .delta{font-size:12px;font-family:ui-monospace,monospace}
.p6 .delta.up{color:#34d399}.p6 .delta.down{color:#f87171}
.p6 .msg{font-size:13px;line-height:1.5;color:#cbd5e1;padding:4px 0;border-bottom:1px solid #16203a}
.p6 .msg b{color:#7dd3fc;font-weight:600}
.p6 .diff{font-family:ui-monospace,monospace;font-size:11px;line-height:1.55;white-space:pre;
  overflow:hidden;color:#64748b}
.p6 .diff .add{color:#34d399}.p6 .diff .del{color:#f87171}
.p6 .row{display:flex;gap:8px;align-items:center}
.p6 .status{font-size:12px;font-family:ui-monospace,monospace;color:#64748b;transition:color .3s}
.p6 .status[data-state="busy"]{color:#fbbf24}
.p6 .status[data-state="ok"]{color:#34d399}
.p6 .check{display:flex;gap:9px;align-items:center;font-size:13px;color:#cbd5e1;padding:3px 0}
.p6 .check input{accent-color:#0ea5e9;width:15px;height:15px}
.p6 .cal{display:flex;gap:10px;font-size:13px;color:#cbd5e1;padding:4px 0;border-bottom:1px solid #16203a}
.p6 .cal .at{font-family:ui-monospace,monospace;font-size:11px;color:#475569;width:44px;flex:none;padding-top:2px}
.p6 .cols{display:flex;gap:10px;flex:1;min-height:0}
.p6 .kcol{flex:1;background:#0a1120;border:1px solid #16203a;border-radius:9px;padding:8px;
  display:flex;flex-direction:column;gap:6px;font-size:10.5px;color:#475569}
.p6 .kcard{background:#152036;border:1px solid #223354;border-radius:6px;padding:6px 8px;
  font-size:11px;color:#cbd5e1;line-height:1.35}
/* Scene focus, painted into the texture. FocusScene stamps [data-focus] on
   the source root (unit = selected in the ring, interior = descended into)
   and [data-engaged] while Enter's commitment holds (Tab traps in the group,
   Escape releases). Survey glow stays dim; engagement is unmistakable —
   the ratified survey-vs-engaged chrome split. Paint properties only —
   border/box-shadow changes are compositor-safe and self-repaint
   (docs/authoring.md). */
/* SELF selectors, not descendant: the stamped unit element IS the .p6 root
   (browser-verified — the descendant form was dead CSS since inc 2). */
.p6[data-focus]{border-color:#38bdf8}
.p6[data-focus="unit"]{box-shadow:inset 0 0 0 2px rgba(56,189,248,.38)}
.p6[data-focus="interior"]{box-shadow:inset 0 0 0 2px rgba(125,211,252,.6)}
.p6[data-engaged]{border-color:#7dd3fc;box-shadow:inset 0 0 0 3px rgba(125,211,252,.78)}
`

export function injectLab006Styles(): () => void {
  if (document.getElementById(STYLE_ID)) return () => {}
  const el = document.createElement('style')
  el.id = STYLE_ID
  el.textContent = CSS
  document.head.appendChild(el)
  return () => el.remove()
}

// ---------------------------------------------------------------------------
// Pulse: the peripheral "something changed here" cue. Paint-property only —
// the background transition self-paints for ~.9s round trip, then the panel
// returns to the free-idle account.

function pulse(root: HTMLElement) {
  root.setAttribute('data-fresh', '1')
  window.setTimeout(() => root.removeAttribute('data-fresh'), 450)
}

const shell = (title: string, tag: string, body: string) =>
  `<div class="p6"><h2>${title}<span class="tag">${tag}</span></h2>${body}</div>`

// ---------------------------------------------------------------------------
// Live feeds

function ciPanel(): PanelSpec {
  const steps = ['install', 'typecheck', 'unit', 'integration', 'deploy preview']
  const body = `
    <div class="fill">${steps
      .map(
        (s, i) =>
          `<div class="step"><span class="dot" data-step="${i}"></span>${s}<span class="t" data-time="${i}"></span></div>`,
      )
      .join('')}</div>
    <div class="status" data-ci-status data-state="busy">run #4128 · main · e4f21c9</div>`
  return {
    id: 'ci',
    html: shell('ci — three-ui', 'live', body),
    feed: (root) => {
      let step = 0
      let run = 4128
      let timer = 0
      const dots = () => root.querySelectorAll<HTMLElement>('.dot')
      const status = root.querySelector<HTMLElement>('[data-ci-status]')!
      const tick = () => {
        if (step < steps.length) {
          dots().forEach((d, i) => {
            d.setAttribute('data-state', i < step ? 'done' : i === step ? 'run' : '')
            if (i < step) root.querySelector(`[data-time="${i}"]`)!.textContent = `${12 + i * 7}s`
          })
          status.textContent = `run #${run} · main · ${steps[step]}…`
          status.setAttribute('data-state', 'busy')
          step++
          timer = window.setTimeout(tick, 2800 + Math.random() * 1600)
        } else {
          dots().forEach((d) => d.setAttribute('data-state', 'done'))
          root.querySelector(`[data-time="${steps.length - 1}"]`)!.textContent = '41s'
          status.textContent = `run #${run} · passed ✓ 2m14s`
          status.setAttribute('data-state', 'ok')
          pulse(root)
          step = 0
          run++
          timer = window.setTimeout(tick, 9000)
        }
      }
      timer = window.setTimeout(tick, 1500)
      return () => window.clearTimeout(timer)
    },
  }
}

function errorsPanel(): PanelSpec {
  const pool: Array<[string, string, string]> = [
    ['err', 'TypeError', 'cannot read uv of undefined · forwardEvents.ts:88'],
    ['warn', 'SlowFrame', 'main thread 21ms · scene lab004'],
    ['err', 'ChunkLoadError', 'dynamic import failed · retrying'],
    ['warn', 'Texture', 'NPOT texture resized · source-12'],
    ['err', 'AbortError', 'fetch /api/telemetry aborted'],
    ['ok', 'Recovered', 'websocket reconnected in 240ms'],
    ['warn', 'Memory', 'heap 412MB, gc pressure rising'],
  ]
  const body = `<div class="fill" data-log>
      <div class="line warn"><b>Boot</b> · collector attached, level=warn</div>
    </div>
    <div class="status">errors.week · prod · sampled 1:10</div>`
  return {
    id: 'errors',
    html: shell('error feed', 'live', body),
    feed: (root) => {
      const log = root.querySelector<HTMLElement>('[data-log]')!
      let i = 0
      const timer = window.setInterval(() => {
        const [cls, name, msg] = pool[i % pool.length]
        i++
        const line = document.createElement('div')
        line.className = `line ${cls}`
        line.innerHTML = `<b>${name}</b> · ${msg}`
        log.prepend(line)
        while (log.children.length > 7) log.lastElementChild!.remove()
        pulse(root)
      }, 5200)
      return () => window.clearInterval(timer)
    },
  }
}

function metricsPanel(): PanelSpec {
  const bars = Array.from({ length: 14 }, (_, i) => `<span data-bar="${i}" style="height:40%"></span>`).join('')
  const body = `
    <div class="row"><span class="big" data-rps>842</span>
      <span class="delta up" data-delta>▲ 2.4%</span></div>
    <div class="bars fill">${bars}</div>
    <div class="status">req/s · edge · us-east</div>`
  return {
    id: 'metrics',
    html: shell('gateway traffic', 'live', body),
    feed: (root) => {
      let rps = 842
      const heights = Array.from({ length: 14 }, () => 40)
      const timer = window.setInterval(() => {
        const jump = (Math.random() - 0.46) * 120
        rps = Math.max(220, Math.round(rps + jump))
        heights.push(Math.max(8, Math.min(100, Math.round(rps / 12))))
        heights.shift()
        // One coalesced mutation batch per tick: number, delta, and 14 bar
        // heights land in a single paint.
        root.querySelector('[data-rps]')!.textContent = String(rps)
        const delta = root.querySelector<HTMLElement>('[data-delta]')!
        delta.textContent = `${jump >= 0 ? '▲' : '▼'} ${Math.abs((jump / rps) * 100).toFixed(1)}%`
        delta.className = `delta ${jump >= 0 ? 'up' : 'down'}`
        root.querySelectorAll<HTMLElement>('[data-bar]').forEach((b, i) => {
          b.style.height = `${heights[i]}%`
        })
        if (Math.abs(jump) > 70) pulse(root)
      }, 3600)
      return () => window.clearInterval(timer)
    },
  }
}

function chatPanel(): PanelSpec {
  const pool: Array<[string, string]> = [
    ['maya', 'the arc layout feels right at 210° — periphery reads as periphery'],
    ['sam', 'paint HUD screenshot in the thread, 33 surfaces at 0/s 🤯'],
    ['maya', 'can we get the pulse cue on the error feed a touch dimmer?'],
    ['devon', 'pushed the focus-dolly tween, cancel-on-input works'],
    ['sam', 'typing into a panel mid-orbit is genuinely uncanny. ship it'],
  ]
  const body = `<div class="fill" data-chat>
      <div class="msg"><b>devon</b> · morning! lab 006 spike day</div>
    </div>
    <div class="status">#three-ui · 3 online</div>`
  return {
    id: 'chat',
    html: shell('team chat', 'live', body),
    feed: (root) => {
      const chat = root.querySelector<HTMLElement>('[data-chat]')!
      let i = 0
      const timer = window.setInterval(() => {
        const [who, text] = pool[i % pool.length]
        i++
        const m = document.createElement('div')
        m.className = 'msg'
        m.innerHTML = `<b>${who}</b> · ${text}`
        chat.appendChild(m)
        while (chat.children.length > 5) chat.firstElementChild!.remove()
        pulse(root)
      }, 8200)
      return () => window.clearInterval(timer)
    },
  }
}

// ---------------------------------------------------------------------------
// Interactive panels — real form semantics; handlers attach via feed()

function notesPanel(): PanelSpec {
  const body = `
    <div class="fill" contenteditable="true" spellcheck="false">Spike notes — click me and just type.<br><br>· periphery pulses are pre-attentive: you notice, you don't read<br>· proximity = priority. pull a panel close to pin it<br>· </div>
    <div class="status">autosaves · caret is the liveness proof</div>`
  return { id: 'notes', html: shell('scratch notes', 'editable', body) }
}

function emailPanel(): PanelSpec {
  const body = `
    <p style="font-size:12px"><b style="color:#cbd5e1">robin@figma.example</b> · re: spatial workspace demo</p>
    <p class="fill" style="font-size:12.5px;overflow:hidden">"…saw the clip — is the text actually live? Can you type into it while the camera moves? Send me a build when you have one."</p>
    <textarea class="p6-field" rows="2" placeholder="reply — it's a real textarea" style="resize:none"></textarea>
    <div class="row"><button class="p6-btn primary" data-send>Send</button>
      <span class="status" data-mail-status>draft</span></div>`
  return {
    id: 'email',
    html: shell('inbox', '1 unread', body),
    feed: (root) => {
      const btn = root.querySelector<HTMLElement>('[data-send]')!
      const status = root.querySelector<HTMLElement>('[data-mail-status]')!
      const area = root.querySelector<HTMLTextAreaElement>('textarea')!
      const send = () => {
        status.textContent = 'sent ✓'
        status.setAttribute('data-state', 'ok')
        area.value = ''
        pulse(root)
      }
      btn.addEventListener('click', send)
      return () => btn.removeEventListener('click', send)
    },
  }
}

function deployPanel(): PanelSpec {
  const body = `
    <div class="row" data-envs>
      <button class="p6-btn" data-env="staging" data-selected="1">staging</button>
      <button class="p6-btn" data-env="prod">prod</button>
    </div>
    <div class="row"><span style="font-size:12px;color:#64748b">version</span>
      <input class="p6-field" data-ver value="1.4.2" style="width:90px"></div>
    <div class="fill"></div>
    <div class="row"><button class="p6-btn primary" data-deploy>Deploy</button>
      <span class="status" data-deploy-status>idle · last deploy 2h ago</span></div>`
  return {
    id: 'deploy',
    html: shell('deploy', 'real form', body),
    feed: (root) => {
      const status = root.querySelector<HTMLElement>('[data-deploy-status]')!
      const ver = root.querySelector<HTMLInputElement>('[data-ver]')!
      let timer = 0
      const onEnv = (e: Event) => {
        const btn = (e.target as HTMLElement).closest('[data-env]')
        if (!btn) return
        root.querySelectorAll('[data-env]').forEach((b) => b.removeAttribute('data-selected'))
        btn.setAttribute('data-selected', '1')
      }
      const onDeploy = () => {
        const env = root.querySelector('[data-env][data-selected]')!.getAttribute('data-env')
        status.textContent = `deploying v${ver.value} → ${env}…`
        status.setAttribute('data-state', 'busy')
        pulse(root)
        timer = window.setTimeout(() => {
          status.textContent = `v${ver.value} live on ${env} ✓`
          status.setAttribute('data-state', 'ok')
          pulse(root)
        }, 2600)
      }
      const envs = root.querySelector<HTMLElement>('[data-envs]')!
      const deploy = root.querySelector<HTMLElement>('[data-deploy]')!
      envs.addEventListener('click', onEnv)
      deploy.addEventListener('click', onDeploy)
      return () => {
        envs.removeEventListener('click', onEnv)
        deploy.removeEventListener('click', onDeploy)
        window.clearTimeout(timer)
      }
    },
  }
}

// The mixed-group proof (lab 007 increment 2): DOM tabbables and a WebGL
// dial in ONE focus traversal. Tab walks the wave buttons, continues onto
// the knob (a leaf proxy carries real focus), arrows ratchet it through the
// physics, and the readout below is live DOM painted by the dial's detents.
const CUTOFFS = ['110 Hz', '220 Hz', '440 Hz', '880 Hz', '1.2 kHz', '2.4 kHz', '4.8 kHz', '9.6 kHz']

function synthPanel(): PanelSpec {
  const body = `
    <div class="row" data-waves>
      <button class="p6-btn" data-wave="saw" data-selected="1">saw</button>
      <button class="p6-btn" data-wave="square">square</button>
      <button class="p6-btn" data-wave="sine">sine</button>
    </div>
    <div class="row" style="align-items:baseline"><span style="font-size:12px;color:#64748b">cutoff</span>
      <span class="big" data-cutoff>${CUTOFFS[3]}</span></div>
    <div class="fill"></div>
    <div class="status">voice a · the knob beside me is in my tab order</div>`
  return {
    id: 'synth',
    html: shell('filter — voice a', 'mixed group', body),
    dial: { label: 'Cutoff', detents: 8, initialDetent: 3, values: CUTOFFS },
    feed: (root) => {
      const waves = root.querySelector<HTMLElement>('[data-waves]')!
      const onWave = (e: Event) => {
        const btn = (e.target as HTMLElement).closest('[data-wave]')
        if (!btn) return
        root.querySelectorAll('[data-wave]').forEach((b) => b.removeAttribute('data-selected'))
        btn.setAttribute('data-selected', '1')
      }
      waves.addEventListener('click', onWave)
      return () => waves.removeEventListener('click', onWave)
    },
  }
}

function prPanel(): PanelSpec {
  const body = `
    <p style="font-size:12.5px;color:#cbd5e1">#61 · Surface: upload-on-paint contract</p>
    <div class="fill">
      <label class="check"><input type="checkbox" checked> passive by default, no observers</label>
      <label class="check"><input type="checkbox" checked> +1 trailing upload for deferred resolve</label>
      <label class="check"><input type="checkbox"> probe re-run on 60Hz hardware</label>
      <label class="check"><input type="checkbox"> docs: budget corollaries</label>
    </div>
    <div class="row"><button class="p6-btn primary" data-approve>Approve</button>
      <span class="status" data-pr-status>2 of 4 checked</span></div>`
  return {
    id: 'pr',
    html: shell('pull request', 'review', body),
    feed: (root) => {
      const status = root.querySelector<HTMLElement>('[data-pr-status]')!
      const boxes = () => root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
      const onChange = () => {
        const done = Array.from(boxes()).filter((b) => b.checked).length
        status.textContent = `${done} of 4 checked`
      }
      const onApprove = () => {
        status.textContent = 'approved ✓ merging'
        status.setAttribute('data-state', 'ok')
        pulse(root)
      }
      const approve = root.querySelector<HTMLElement>('[data-approve]')!
      root.addEventListener('change', onChange)
      approve.addEventListener('click', onApprove)
      return () => {
        root.removeEventListener('change', onChange)
        approve.removeEventListener('click', onApprove)
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Static panels — the periphery. However many mount, they cost 0 paints/s.

function diffPanel(): PanelSpec {
  const body = `<div class="diff fill">@@ src/primitives/Surface.tsx @@
<span class="del">-    source.repaint()</span>
<span class="del">-    if (source.painted()) texture.needsUpdate = true</span>
<span class="add">+    const count = source.paintCount()</span>
<span class="add">+    if (count !== lastUploadRef.current) {</span>
<span class="add">+      lastUploadRef.current = count</span>
<span class="add">+      extraUploadsRef.current = 1</span>
<span class="add">+      if (source.painted()) texture.needsUpdate = true</span>
<span class="add">+    }</span>
 </div>
    <div class="status">the rewrite that made idle free</div>`
  return { id: 'diff', html: shell('diff · surface.tsx', 'static', body) }
}

function calendarPanel(): PanelSpec {
  const body = `<div class="fill">
    <div class="cal"><span class="at">9:30</span><span>standup — lab 006 spike scope</span></div>
    <div class="cal"><span class="at">11:00</span><span>chrome origin-trial office hours (file the transition-staleness case)</span></div>
    <div class="cal"><span class="at">2:00</span><span>demo cut review — 90s timeline</span></div>
    <div class="cal"><span class="at">4:30</span><span>focus/keyboard pillar planning</span></div>
  </div>
  <div class="status">tuesday · 4 events</div>`
  return { id: 'calendar', html: shell('today', 'static', body) }
}

function kanbanPanel(): PanelSpec {
  const body = `<div class="cols fill">
    <div class="kcol">todo<div class="kcard">press-time UV lock</div><div class="kcard">focus handoff spec</div></div>
    <div class="kcol">doing<div class="kcard">lab 006 spike</div></div>
    <div class="kcol">done<div class="kcard">upload-on-paint</div><div class="kcard">control kit</div></div>
  </div>
  <div class="status">board · library v0</div>`
  return { id: 'kanban', html: shell('sprint', 'static', body) }
}

const DOCS: Array<[string, string[]]> = [
  ['runbook · paint stalls', ['Check the HUD chips first — a relaunched Chrome without flags looks exactly like a broken build.', 'Then __threeUI.stats(): a stalled source shows paints frozen while siblings advance.']],
  ['platform contract', ['drawElementImage replays the paint record; whatever the compositor owns never enters it.', 'The record changing IS the change signal. Idle subtrees fire nothing.']],
  ['authoring dialect', ['If it changes what the surface says, mutate the DOM. If it changes where it is, move the matter.', 'Hover ships as data-hover. Pulses are background, never opacity.']],
  ['okrs · q3', ['O: the reference implementation for HTML-in-canvas UI.', 'KR1: focus/keyboard complete. KR2: killer demo shipped. KR3: origin-trial feedback filed.']],
  ['retro · lab 005', ['One integrator, three force fields — new controls are new fields, zero new state machines.', 'Physics deciding a toggle beats animating one.']],
  ['glossary', ['Surface: DOM subtree as the skin of geometry. SurfaceLayer: floating UI anchored to a UV point.', 'Paint record: the display list drawElementImage replays.']],
  ['incident · 007', ['A transition: opacity in a teammate panel shipped a stale texture that healed on unrelated repaints.', 'Root cause: compositor-owned property. Now a hard authoring rule.']],
  ['roadmap', ['v0: floating layers ✓, control kit ✓, focus/keyboard ◐, scale contract ✓.', 'Next: graceful degradation to overlay DOM when the API is absent.']],
  ['api sketch', ['<Surface html width height paint> wraps any geometry.', 'onSource hands you the live root — attach listeners, mutate, cleanup on return.']],
  ['perf notes', ['Ceiling is per-source fixed cost, not pixels: 4× texels, same fps.', 'Budget ~64–96 concurrently painting at 120Hz. Idle is free.']],
  ['reading list', ['Data Mountain (Robertson 98) — spatial memory beats lists.', 'Calm technology (Weiser) — the periphery is a feature, not noise.']],
  ['oncall', ['This week: devon. Escalation: #three-ui-alerts.', 'Known flake: daemon relaunches Chrome without --args when the window closes.']],
  ['release notes · 0.4', ['SurfaceLayer orients along surface normals; anchors survive deformation.', 'Surface: late-mount needsUpdate fix — no more blank white meshes.']],
  ['hiring', ['Open: design engineer, physical interfaces.', 'Signal we want: has shipped something where the medium was the message.']],
  ['research questions', ['Does peripheral pulse rate change task performance vs. badges?', 'At what panel count does spatial memory beat cmd-tab?']],
  ['links', ['chrome status: canvas-draw-element · intent-to-experiment thread', 'demo cut storyboard · figjam/spatial-workspace']],
  ['decisions digest', ['Primitives over components — scenes are disposable evidence.', 'Upload-on-paint over observers: when the system emits the event, delete the inference.']],
  ['budget', ['Origin-trial bet: keep burn at lab scale until a ship signal.', 'One demo > three half-demos.']],
  ['spec · focus', ['Approach a panel: focus enters. Dolly away: blur, with the focus ring honest the whole way.', 'Tab crosses panels in arc order; Esc returns focus to the room.']],
  ['weekly metrics', ['Repo: 9 commits. Labs: 6. Probes: 2.', 'Longest-lived bug: hover pseudo-class mirage, 1 day.']],
  ['meeting notes', ['Decided: the demo is the cockpit, not the groovebox.', 'The criteria: DOM and WebGL both load-bearing, useful over fun.']],
  ['ideas', ['Panel piles with real collision (rapier is already in the tree).', 'A "quiet mode" that dims everything not recently painted — the HUD knows.']],
]

function docPanel([title, lines]: [string, string[]], i: number): PanelSpec {
  return {
    id: `doc-${i}`,
    html: shell(title, 'static', `<div class="fill">${lines.map((l) => `<p>${l}</p>`).join('')}</div>`),
  }
}

// ---------------------------------------------------------------------------
// The roster: 33 panels. Live + interactive panels sit mid-arc where their
// pulses land in the viewer's periphery; static docs fill the rest.

export function buildPanels(): PanelSpec[] {
  const docs = DOCS.map(docPanel)
  const roster: PanelSpec[] = [
    // row 0 (bottom)
    docs[0], docs[1], metricsPanel(), docs[2], docs[3], prPanel(), docs[4], docs[5], calendarPanel(), docs[6], docs[7],
    // row 1 (eye level) — synth sits mid-arc where its knob is reachable
    docs[8], docs[9], ciPanel(), docs[10], emailPanel(), notesPanel(), deployPanel(), synthPanel(), errorsPanel(), docs[12], docs[13],
    // row 2 (top)
    docs[14], docs[15], docs[16], docs[17], diffPanel(), kanbanPanel(), docs[18], chatPanel(), docs[19], docs[20], docs[21],
  ]
  return roster
}
