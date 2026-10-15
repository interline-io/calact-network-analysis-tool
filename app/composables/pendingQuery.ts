import { computed, nextTick, reactive, type ComputedRef } from 'vue'
import type { LocationQuery, LocationQueryRaw } from 'vue-router'

type QueryValue = LocationQueryRaw[string]

// The URL query with writes that haven't reached the URL yet laid over it.
//
// A router navigation takes a frame or so to land, but the URL-backed state
// has to read back what was just set: catenary's cat-input, like Vue's own
// v-model, expects its bound value to update as soon as it emits, or the
// field's text falls out of step with what was typed. So a write goes into
// `pending` at once, the getters read the merged query, and the pending
// writes reach the URL together in one navigation on the next tick. A key
// leaves `pending` once the URL holds it, unless it was written again in
// the meantime.
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
    this.query = computed(() => this.merge(this.pending))
  }

  // null and undefined remove a key, as they do in the URL.
  set (params: Record<string, QueryValue>): Promise<void> {
    for (const [k, v] of Object.entries(params)) {
      this.pending.set(k, v)
    }
    this.flushing ??= nextTick().then(() => this.flush())
    return this.flushing
  }

  private async flush (): Promise<void> {
    const sent = new Map(this.pending)
    this.flushing = undefined
    try {
      await this.navigate(this.merge(sent))
    } finally {
      for (const [k, v] of sent) {
        if (this.pending.get(k) === v) {
          this.pending.delete(k)
        }
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
        merged[k] = v as LocationQuery[string]
      }
    }
    return merged
  }
}
