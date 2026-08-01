// @vitest-environment happy-dom
//
// The style bridge's plumbing. happy-dom has no style engine — computed
// custom properties come back empty and CSS.registerProperty doesn't exist —
// so getComputedStyle is stubbed per element and the tests exercise what the
// channel DOES with values: live reads, the transition-bounded rAF sampling
// window, discrete-change coalescing, and teardown. Whether real CSS eases
// the value is the browser's half (verified live — see the lab journal).

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createStyleChannel, ensureChannelRegistered, type StyleChannel } from './styleChannel'

let value = '0'
function channelEl(): HTMLElement {
  const el = document.createElement('div')
  document.body.append(el)
  const real = window.getComputedStyle.bind(window)
  vi.spyOn(window, 'getComputedStyle').mockImplementation((target: Element) => {
    const style = real(target)
    if (target === el) {
      const orig = style.getPropertyValue.bind(style)
      return new Proxy(style, {
        get: (t, k) =>
          k === 'getPropertyValue'
            ? (p: string) => (p === '--depth' ? value : orig(p))
            : Reflect.get(t, k),
      }) as CSSStyleDeclaration
    }
    return style
  })
  return el
}

const channels: StyleChannel[] = []
function channel(el: HTMLElement) {
  const c = createStyleChannel(el, '--depth')
  channels.push(c)
  return c
}
afterEach(() => {
  while (channels.length) channels.pop()!.dispose()
  vi.restoreAllMocks()
  value = '0'
  document.body.innerHTML = ''
})

const flush = () => new Promise<void>((r) => queueMicrotask(() => r()))
const transition = (el: HTMLElement, type: string, propertyName = '--depth') => {
  const e = new Event(type, { bubbles: true }) as TransitionEvent & { propertyName: string }
  Object.defineProperty(e, 'propertyName', { value: propertyName })
  el.dispatchEvent(e)
}

describe('get', () => {
  it('reads the computed value live', () => {
    const el = channelEl()
    const c = channel(el)
    expect(c.get()).toBe(0)
    value = '0.75'
    expect(c.get()).toBe(0.75)
  })

  it('falls back to the initial value when the property is unset', () => {
    const el = channelEl()
    value = ''
    const c = createStyleChannel(el, '--depth', { initialValue: '0.5' })
    channels.push(c)
    expect(c.get()).toBe(0.5)
  })
})

describe('the transition window', () => {
  it('samples per frame between transitionrun and transitionend', () => {
    const el = channelEl()
    const c = channel(el)
    const cb = vi.fn()
    c.observe(cb)

    const frames: FrameRequestCallback[] = []
    const raf = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((f) => (frames.push(f), frames.length))

    transition(el, 'transitionrun')
    expect(frames.length).toBe(1)
    value = '0.3'
    frames[0](0)
    expect(cb).toHaveBeenCalledWith(0.3)
    value = '0.6'
    frames[1](0)
    expect(cb).toHaveBeenCalledWith(0.6)

    transition(el, 'transitionend')
    value = '1'
    frames[2](0) // window closed — this frame is the loop noticing
    expect(frames.length).toBe(3)
    raf.mockRestore()
  })

  it('lands the exact final value after the window closes', async () => {
    const el = channelEl()
    const c = channel(el)
    const cb = vi.fn()
    c.observe(cb)
    transition(el, 'transitionrun')
    value = '1'
    transition(el, 'transitionend')
    await flush()
    expect(cb).toHaveBeenCalledWith(1)
  })

  it('ignores transitions of other properties', () => {
    const el = channelEl()
    channel(el)
    const raf = vi.spyOn(window, 'requestAnimationFrame')
    transition(el, 'transitionrun', 'opacity')
    expect(raf).not.toHaveBeenCalled()
    raf.mockRestore()
  })
})

describe('discrete changes', () => {
  it('emits once, coalesced, after an attribute change', async () => {
    const el = channelEl()
    const c = channel(el)
    const cb = vi.fn()
    c.observe(cb)
    value = '0.4'
    el.setAttribute('data-hover', '')
    el.className = 'lifted'
    await flush()
    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb).toHaveBeenCalledWith(0.4)
  })

  it('does not emit when the value did not move', async () => {
    const el = channelEl()
    const c = channel(el)
    const cb = vi.fn()
    c.observe(cb)
    el.setAttribute('data-inert', '')
    await flush()
    expect(cb).not.toHaveBeenCalled()
  })
})

describe('teardown', () => {
  it('unsubscribe and dispose both silence the channel', async () => {
    const el = channelEl()
    const c = channel(el)
    const cb = vi.fn()
    const off = c.observe(cb)
    off()
    value = '0.9'
    el.setAttribute('data-x', '')
    await flush()
    expect(cb).not.toHaveBeenCalled()

    const cb2 = vi.fn()
    c.observe(cb2)
    c.dispose()
    value = '0.1'
    el.setAttribute('data-y', '')
    await flush()
    expect(cb2).not.toHaveBeenCalled()
  })
})

describe('registration', () => {
  it('is idempotent and survives a missing CSS.registerProperty', () => {
    // happy-dom has no CSS.registerProperty — must not throw.
    expect(() => {
      ensureChannelRegistered('--depth')
      ensureChannelRegistered('--depth')
    }).not.toThrow()
  })
})
