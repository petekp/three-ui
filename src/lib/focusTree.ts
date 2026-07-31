// Focus tree core — pure logic for docs/focus.md (lab 007).
//
// Scene → groups → members, one level deep by design. This module owns the
// parts that are testable without a DOM or a camera: member ordering,
// per-group focus memory, and screen-space reading order. The manager
// (FocusScene) supplies geometry and does the actual element.focus() calls —
// the invariant "scene focus IS document focus" means nothing in here stores
// which thing is focused; that truth lives in document.activeElement only.

export type TargetKind = 'composite' | 'leaf'

export interface MemberInfo<T> {
  id: string
  kind: TargetKind
  /** Authored order (Flutter OrderedTraversalPolicy): ordered members sort
   *  first (stable among equals), unordered follow in registration order. */
  order?: number
  /** Opaque payload for the manager (elements, meshes). */
  data: T
}

/**
 * The focus-memory discipline (Flutter _focusedChildren), reusable at both
 * layers: the tree remembers member ids per group; the manager remembers
 * interior HTMLElements per composite. Same rules everywhere — push-to-top
 * dedupe by identity, destructive lazy validation at recall, eager forget.
 */
export interface MemoryStack<T> {
  remember(item: T): void
  /** Top valid item; pops rejects destructively. Null when exhausted. */
  recall(valid: (item: T) => boolean): T | null
  forget(item: T): void
  clear(): void
}

export function createMemoryStack<T>(): MemoryStack<T> {
  let stack: T[] = []
  return {
    remember(item) {
      stack = stack.filter((x) => x !== item)
      stack.push(item)
    },
    recall(valid) {
      while (stack.length > 0) {
        const top = stack[stack.length - 1]
        if (valid(top)) return top
        stack.pop()
      }
      return null
    },
    forget(item) {
      stack = stack.filter((x) => x !== item)
    },
    clear() {
      stack = []
    },
  }
}

interface GroupRecord<T> {
  id: string
  label?: string
  seq: number
  members: Map<string, MemberInfo<T> & { seq: number }>
  /** Focus memory over member ids; validation happens lazily at recall. */
  memory: MemoryStack<string>
}

export interface FocusTree<T> {
  registerGroup(id: string, label?: string): void
  unregisterGroup(id: string): void
  registerMember(groupId: string, member: MemberInfo<T>): void
  unregisterMember(groupId: string, memberId: string): void
  groups(): { id: string; label?: string }[]
  members(groupId: string): MemberInfo<T>[]
  /** Push-to-top with dedupe. Call on every focus that lands in the group. */
  remember(groupId: string, memberId: string): void
  /**
   * Top of the memory stack, popping entries the validator rejects
   * (unmounted, disabled — Flutter's lazy cleanout). Returns null when the
   * stack empties: the caller falls back to first-in-order.
   */
  recall(groupId: string, valid: (member: MemberInfo<T>) => boolean): MemberInfo<T> | null
  /**
   * Explicit unfocus (Escape-ascend) clears the stack — otherwise Tab right
   * after Escape re-focuses the thing just left, and repeated Escapes walk
   * backwards through history (both bugs documented in Flutter's source).
   */
  clearMemory(groupId: string): void
}

export function createFocusTree<T>(): FocusTree<T> {
  const groups = new Map<string, GroupRecord<T>>()
  let seq = 0

  return {
    registerGroup(id, label) {
      const existing = groups.get(id)
      if (existing) {
        // Members may have arrived first (see registerMember) — adopt the
        // implicit record rather than dropping its members.
        existing.label = label
        return
      }
      groups.set(id, { id, label, seq: seq++, members: new Map(), memory: createMemoryStack() })
    },
    unregisterGroup(id) {
      groups.delete(id)
    },
    registerMember(groupId, member) {
      // React child effects run bottom-up: a group's members register BEFORE
      // the group itself. Silently dropping them was a real bug (the lab-006
      // dial vanished from its group's traversal); create the group record
      // implicitly and let registerGroup fill in the label when it arrives.
      let g = groups.get(groupId)
      if (!g) {
        g = { id: groupId, seq: seq++, members: new Map(), memory: createMemoryStack() }
        groups.set(groupId, g)
      }
      g.members.set(member.id, { ...member, seq: seq++ })
    },
    unregisterMember(groupId, memberId) {
      const g = groups.get(groupId)
      if (!g) return
      g.members.delete(memberId)
      // Eager scrub (Flutter _removeChild): a dead id must not linger where
      // recall could resurrect it between validations.
      g.memory.forget(memberId)
    },
    groups() {
      return [...groups.values()]
        .sort((a, b) => a.seq - b.seq)
        .map(({ id, label }) => ({ id, label }))
    },
    members(groupId) {
      const g = groups.get(groupId)
      if (!g) return []
      const all = [...g.members.values()]
      const ordered = all
        .filter((m) => m.order !== undefined)
        .sort((a, b) => (a.order! - b.order!) || (a.seq - b.seq))
      // Unordered default: composites before leaves, registration order
      // within each kind. This is docs/focus.md's interior contract ("the
      // Surface's own tabbables ... then satellite leaves") made immune to
      // mount timing — composites register LATE (their source element is
      // created async), so raw seq would put every satellite ahead of its
      // panel. Explicit `order` remains the author's escape hatch.
      const rank = (m: MemberInfo<T>) => (m.kind === 'composite' ? 0 : 1)
      const unordered = all
        .filter((m) => m.order === undefined)
        .sort((a, b) => rank(a) - rank(b) || a.seq - b.seq)
      return [...ordered, ...unordered]
    },
    remember(groupId, memberId) {
      const g = groups.get(groupId)
      if (!g || !g.members.has(memberId)) return
      g.memory.remember(memberId)
    },
    recall(groupId, valid) {
      const g = groups.get(groupId)
      if (!g) return null
      const id = g.memory.recall((memberId) => {
        const m = g.members.get(memberId)
        return m !== undefined && valid(m)
      })
      return id === null ? null : g.members.get(id)!
    },
    clearMemory(groupId) {
      groups.get(groupId)?.memory.clear()
    },
  }
}

// ---------------------------------------------------------------------------
// Interior traversal across a group's members (docs/focus.md "Tab model"):
// inside a composite member the BROWSER owns Tab; the manager owns every
// member boundary — a composite's edge, and both sides of a leaf proxy
// (proxies live in the shared portal layer, so native Tab order around them
// is meaningless). Pure decision: given each member's element sequence (a
// composite's tabbables in DOM order; a leaf's single proxy) and the active
// element, what does this Tab press do?

export type BoundaryAction<E> =
  | { type: 'native' } // mid-composite: let the browser move focus
  | { type: 'move'; to: E } // crossing a member boundary: focus this element
  | { type: 'exit' } // past the last member: leave to the next unit
  | { type: 'ascend' } // Shift+Tab before the first member: up to own unit

export function interiorBoundary<E>(
  seqs: readonly (readonly E[])[],
  active: E,
  dir: 1 | -1,
): BoundaryAction<E> {
  const flat: { el: E; member: number }[] = []
  seqs.forEach((seq, member) => {
    for (const el of seq) flat.push({ el, member })
  })
  const idx = flat.findIndex((f) => f.el === active)
  // Unknown element (click-focused something outside the computed sequence):
  // never fight the browser from a position we can't reason about.
  if (idx === -1) return { type: 'native' }
  const j = idx + dir
  if (j < 0) return { type: 'ascend' }
  if (j >= flat.length) return { type: 'exit' }
  return flat[j].member === flat[idx].member
    ? { type: 'native' }
    : { type: 'move', to: flat[j].el }
}

// ---------------------------------------------------------------------------
// Screen-space reading order — Flutter ReadingOrderTraversalPolicy's band
// algorithm (LTR only; we have no RTL scenes). Selection loop: take the
// topmost remaining rect, form the infinite horizontal band spanning its
// vertical extent, collect every rect intersecting the band, emit the
// leftmost, repeat. Every comparison ties back to input order (stable) so
// equal-coordinate panels never shuffle between keypresses — Flutter treats
// sort stability as contract, and so do we.

export interface OrderRect {
  id: string
  x: number
  y: number
  w: number
  h: number
}

export function readingOrder(rects: readonly OrderRect[]): string[] {
  const remaining = rects.map((r, i) => ({ ...r, i }))
  const out: string[] = []
  while (remaining.length > 0) {
    let top = remaining[0]
    for (const r of remaining) {
      if (r.y < top.y || (r.y === top.y && r.i < top.i)) top = r
    }
    const bandTop = top.y
    const bandBottom = top.y + top.h
    let pick = top
    for (const r of remaining) {
      const inBand = r.y < bandBottom && r.y + r.h > bandTop
      if (!inBand) continue
      if (r.x < pick.x || (r.x === pick.x && r.i < pick.i)) pick = r
    }
    out.push(pick.id)
    remaining.splice(remaining.indexOf(pick), 1)
  }
  return out
}
