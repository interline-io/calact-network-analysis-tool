// Items by a key, each key's items in their order.
export function groupBy<T, K> (items: Iterable<T>, keyOf: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>()
  for (const item of items) {
    const key = keyOf(item)
    const list = groups.get(key)
    if (list) {
      list.push(item)
    } else {
      groups.set(key, [item])
    }
  }
  return groups
}

// Names in order, a blank one last.
export function compareNamesBlankLast (a: string, b: string): number {
  if (!a || !b) {
    return Number(!a) - Number(!b)
  }
  return a.localeCompare(b)
}
