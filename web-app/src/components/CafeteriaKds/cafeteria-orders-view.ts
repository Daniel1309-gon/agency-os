import type { CafeteriaOrder } from '@agency-os/shared';

function isStale(existing: CafeteriaOrder | undefined, incoming: CafeteriaOrder): boolean {
  return existing?.seq !== undefined && incoming.seq !== undefined && incoming.seq < existing.seq;
}

export function mergeOrders(current: CafeteriaOrder[], incoming: CafeteriaOrder[]): CafeteriaOrder[] {
  const byId = new Map(current.map((order) => [order.id, order]));
  for (const order of incoming) {
    if (!isStale(byId.get(order.id), order)) byId.set(order.id, order);
  }
  return [...byId.values()].sort((left, right) => right.placedAt.localeCompare(left.placedAt));
}

/**
 * A full snapshot is authoritative: an order it no longer lists (delivered, expired,
 * cancelled) leaves the kitchen display. Only orders applied after the snapshot was
 * taken (higher seq) survive, because the snapshot could not know about them.
 * An empty snapshot carries no seq, so it cannot prove which local orders are
 * older: they are kept, and the next non-empty snapshot or event settles them.
 */
export function applyOrderSnapshot(current: CafeteriaOrder[], snapshot: CafeteriaOrder[]): CafeteriaOrder[] {
  const snapshotSeq = Math.max(...snapshot.map((order) => order.seq ?? -Infinity));
  const newerThanSnapshot = current.filter((order) => order.seq !== undefined && order.seq > snapshotSeq);
  return mergeOrders(newerThanSnapshot, snapshot);
}
