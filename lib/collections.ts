// Index once, then look up groups without scanning the source for every row.
// Input order and object identity are preserved; missing groups stay absent.
export function groupBy<T, K>(items: readonly T[], keyFor: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const key = keyFor(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}
