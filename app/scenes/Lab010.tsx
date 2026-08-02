import { useEffect, useRef, useState } from 'react'
import type { Group } from 'three'
import { FocusGroup, SurfaceApp } from 'three-ui'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageGroup,
} from '@/components/ui/message'
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@/components/ui/message-scroller'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'

// Lab 010 — an agentic coding UI in full 3D.
//
// Increment 3: the chat panel. A conversation with a coding agent is the
// centerpiece of the scene and the consumer that forced the scroll seam
// (decisions #29): shadcn's message-scroller is a real `overflow-y-auto`
// viewport with autoscroll machinery driven by `scroll` events — all of
// which now works through the texture because the forwarder performs the
// scroll and the paint record follows the offset. Everything here is
// byte-verbatim registry code composed as any web app would compose it;
// the scene's only contribution is a mesh for it to be matter on.

const PX = 200 // source px per world unit (house scale)
const CHAT_W = 440
const CHAT_H = 580

interface ChatTurn {
  id: number
  role: 'user' | 'agent'
  text: string
  code?: string
  tool?: string
}

const SEED: ChatTurn[] = [
  {
    id: 1,
    role: 'user',
    text: 'The chat log has to scroll inside the panel. Does the wheel even reach it through the canvas?',
  },
  {
    id: 2,
    role: 'agent',
    text: 'Measured it first: scroll offsets invalidate the paint record like any descendant mutation — one paint per jump, pixels verified. The seam was input only. Synthetic wheels never trigger native scrolling, so the forwarder now performs the scroll itself.',
    tool: 'npm run test — 240 passed',
  },
  {
    id: 3,
    role: 'user',
    text: 'And the camera? I do not want to zoom every time I scroll the log.',
  },
  {
    id: 4,
    role: 'agent',
    text: 'The room is the outermost scroll container. A wheel the panel consumes stops at document capture, before OrbitControls hears it; a wheel nothing can use chains through to the camera, exactly like scroll chaining reaching the page.',
    code: 'if (forwardWheel(root, at.x, at.y, e)) {\n  e.preventDefault()\n  e.stopImmediatePropagation()\n}',
  },
  {
    id: 5,
    role: 'agent',
    text: 'Your scroller viewport declares overscroll-contain, so the log at its bottom refuses to hand the wheel onward. Try it: wheel here, then over the floor.',
  },
]

const REPLIES: Array<Pick<ChatTurn, 'text' | 'code' | 'tool'>> = [
  {
    text: 'On it. Reading the registry source before touching anything — the components stay byte-verbatim, so whatever this needs has to come from the primitives underneath.',
    tool: 'grep -rn "overflow" app/components/ui — 12 hits',
  },
  {
    text: 'Done and verified in the browser: trusted input through the mesh, paint counters flat while idle. The texture never repaints unless something actually changes — that contract is what the whole library stands on.',
  },
  {
    text: 'That one is a platform question, and the honest answer comes from a probe, not from reasoning. Give me a moment to measure it.',
    code: 'const before = __threeUI.stats()\n// ... trusted CDP input ...\nconst after = __threeUI.stats()',
  },
]

function ToolRow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2.5 py-1.5 font-mono text-xs text-muted-foreground">
      <span className="text-emerald-500">✓</span>
      {label}
    </div>
  )
}

function AgentChat() {
  const [turns, setTurns] = useState<ChatTurn[]>(SEED)
  const [draft, setDraft] = useState('')
  const [streaming, setStreaming] = useState(false)
  const nextId = useRef(SEED.length + 1)
  const replyIx = useRef(0)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current)
  }, [])

  const send = (raw?: string) => {
    const text = (raw ?? draft).trim()
    if (!text || streaming) return
    setDraft('')
    const reply = REPLIES[replyIx.current++ % REPLIES.length]
    const userId = nextId.current++
    const agentId = nextId.current++
    setTurns((t) => [...t, { id: userId, role: 'user', text }])
    setStreaming(true)

    // Stream the reply word by word — each tick is one honest paint, and the
    // scroller's autoscroll rides the growing content.
    const words = reply.text.split(' ')
    let n = 0
    setTurns((t) => [...t, { id: agentId, role: 'agent', text: '' }])
    timer.current = setInterval(() => {
      n += 1
      const done = n >= words.length
      setTurns((t) =>
        t.map((turn) =>
          turn.id === agentId
            ? {
                ...turn,
                text: words.slice(0, n).join(' '),
                ...(done ? { code: reply.code, tool: reply.tool } : null),
              }
            : turn,
        ),
      )
      if (done) {
        if (timer.current) clearInterval(timer.current)
        timer.current = null
        setStreaming(false)
      }
    }, 50)
  }

  useEffect(() => {
    ;(window as Lab010Window).__lab010 = {
      send,
      streaming,
      turns: turns.length,
      viewport: () =>
        document.querySelector<HTMLElement>('[data-slot="message-scroller-viewport"]'),
    }
  })

  return (
    <div
      className="flex flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm"
      style={{ width: CHAT_W, height: CHAT_H }}
    >
      <header className="flex items-center gap-2.5 border-b px-4 py-3">
        <Avatar className="size-7">
          <AvatarFallback className="bg-primary text-xs font-semibold text-primary-foreground">
            F5
          </AvatarFallback>
        </Avatar>
        <div className="flex flex-col">
          <span className="text-sm leading-none font-semibold">fable</span>
          <span className="text-xs text-muted-foreground">
            {streaming ? 'working…' : 'idle'}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {streaming ? <Spinner className="size-3.5" /> : null}
          <Badge variant="secondary" className="font-mono text-[10px]">
            three-ui
          </Badge>
        </div>
      </header>

      <MessageScrollerProvider>
        <MessageScroller className="flex-1">
          <MessageScrollerViewport aria-label="Conversation">
            <MessageScrollerContent className="gap-5 px-4 py-4">
              {turns.map((turn, i) => (
                <MessageScrollerItem
                  key={turn.id}
                  messageId={String(turn.id)}
                  scrollAnchor={i === turns.length - 1}
                >
                  {turn.role === 'user' ? (
                    <Bubble align="end">
                      <BubbleContent className="bg-primary text-primary-foreground">
                        {turn.text}
                      </BubbleContent>
                    </Bubble>
                  ) : (
                    <MessageGroup>
                      <Message>
                        <MessageAvatar>
                          <Avatar className="size-8">
                            <AvatarFallback className="bg-muted text-xs">F5</AvatarFallback>
                          </Avatar>
                        </MessageAvatar>
                        <MessageContent>
                          {turn.text ? <div>{turn.text}</div> : <Spinner className="size-3.5" />}
                          {turn.code ? (
                            <pre className="overflow-x-auto rounded-md border bg-muted/40 p-2.5 font-mono text-xs leading-relaxed">
                              {turn.code}
                            </pre>
                          ) : null}
                          {turn.tool ? <ToolRow label={turn.tool} /> : null}
                        </MessageContent>
                      </Message>
                    </MessageGroup>
                  )}
                </MessageScrollerItem>
              ))}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>

      <footer className="border-t p-3">
        <div className="flex items-end gap-2">
          <Textarea
            id="l10-composer"
            placeholder="Ask the agent…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            className="max-h-24 min-h-9 flex-1 resize-none"
          />
          <Button size="sm" onClick={() => send()} disabled={streaming || !draft.trim()}>
            Send
          </Button>
        </div>
        <div className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground">
          <Kbd>Enter</Kbd> to send · <Kbd>Shift</Kbd>
          <Kbd>Enter</Kbd> for a new line
        </div>
      </footer>
    </div>
  )
}

interface Lab010Window extends Window {
  __lab010?: {
    send: (text?: string) => void
    streaming: boolean
    turns: number
    viewport: () => HTMLElement | null
  }
}
declare const window: Lab010Window

export function Lab010() {
  const chatGroup = useRef<Group>(null)

  return (
    <>
      <fog attach="fog" args={['#101014', 10, 26]} />
      <ambientLight intensity={0.55} />
      <directionalLight position={[4, 7, 4]} intensity={1.4} castShadow />
      <pointLight position={[-3, 3, 3]} intensity={14} color="#9db4ff" distance={12} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
        <circleGeometry args={[12, 64]} />
        <meshStandardMaterial color="#15161c" roughness={0.95} />
      </mesh>

      <group position={[0, 1.62, 0]} ref={chatGroup}>
        <FocusGroup id="agent-chat" order={0} objectRef={chatGroup}>
          <SurfaceApp
            content={<AgentChat />}
            label="lab010-chat"
            width={CHAT_W}
            height={CHAT_H}
            castShadow
          >
            <planeGeometry args={[CHAT_W / PX, CHAT_H / PX]} />
          </SurfaceApp>
        </FocusGroup>
      </group>
    </>
  )
}
