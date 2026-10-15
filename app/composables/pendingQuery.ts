import { computed, nextTick, reactive, type ComputedRef } from 'vue'
import type { LocationQuery, LocationQueryRaw } from 'vue-router'

// A value written to the URL query. null and undefined remove the key.
export type QueryValue = string | string[] | null | undefined

// The URL query with writes that haven't reached the URL yet laid over it.
//
// A router navigation takes a frame or so to land, but the URL-backed state
// has to read back what was just set: catenary's cat-input, like Vue's own
// v-model, expects its bound value to update as soon as it emits, or the
// field's text falls out of step with what was typed. So a write goes into
// `pending` at once, the getters read the merged query, and the pending
// writes reach the URL together in one navigation on the next tick.
//
// Every write to the query goes through here: two writers each merging
// their own keys over a route.query the other hasn't updated yet would
// drop each other's changes.
export class PendingQuery {
  private pending = reactive(new Map<string, QueryValue>())
  private flushing: Promise<void> | undefined
  readonly query: ComputedRef<LocationQuery>

  constructor (
    private read: () => LocationQuery,
    private navigate: (query: LocationQueryRaw) => Promise<unknown>,
  ) {
    // Keeps the previous object when the content is the same, as it is when a
    // write lands in the URL and when it then leaves `pending`. Every
    // URL-backed getter reads this, so a new object would refilter the whole
    // scenario for nothing.
    this.query = computed((previous?: LocationQuery) => {
      const next = this.merge(this.pending)
      return previous && sameQuery(previous, next) ? previous : next
    })
  }

  set (params: Record<string, QueryValue>): Promise<void> {
    for (const [k, v] of Object.entries(params)) {
      this.pending.set(k, v)
    }
    this.flushing ??= nextTick().then(() => this.flush())
    return this.flushing
  }

  // Drops the writes not yet in the URL, for a back or forward navigation:
  // the restored history entry wins over edits it went back past.
  discard (): void {
    this.pending.clear()
  }

  private async flush (): Promise<void> {
    const sent = new Map(this.pending)
    this.flushing = undefined
    try {
      await this.navigate(this.merge(sent))
    } catch (error) {
      console.error('[useUrlQuery] navigation failed:', error)
    }
    // A write leaves `pending` once the URL holds it. One the URL doesn't
    // hold (the navigation was cancelled or failed) stays if a later flush
    // will send it again; otherwise the URL is the truth and it goes.
    const url = this.read()
    for (const [k, v] of sent) {
      if (this.pending.get(k) === v && (sameValue(url[k], v) || !this.flushing)) {
        this.pending.delete(k)
      }
    }
  }

  private merge (writes: Map<string, QueryValue>): LocationQuery {
    const merged: LocationQuery = {}
    for (const [k, v] of Object.entries(this.read())) {
      if (!writes.has(k)) {
        merged[k] = v
      }
    }
    for (const [k, v] of writes) {
      if (v != null) {
        merged[k] = v
      }
    }
    return merged
  }
}

function sameValue (a: LocationQuery[string] | undefined, b: QueryValue): boolean {
  if (a == null || b == null) {
    return a == null && b == null
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i])
  }
  return a === b
}

function sameQuery (a: LocationQuery, b: LocationQuery): boolean {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every(k => k in b && sameValue(a[k], b[k] as QueryValue))
}
