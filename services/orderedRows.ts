// Rows a parent keeps in the order its owner sets: a product's specs, a
// project's details (ONE-140). An edit hands back the whole list in its new
// order; these turn that into the fewest writes, and make them.
//
// Shared here rather than in either feature, since a feature's api.ts never
// imports another feature's.

import { supabase } from './supabase.native';

/** A row as stored: its id and its place. */
export type StoredRow<T> = T & { id: string; sortOrder: number };

/** A row as an edit hands it back: `id` when it is already stored. */
export type EditedRow<T> = T & { id?: string };

export interface OrderedRowChanges<T> {
  inserts: (T & { sortOrder: number })[];
  updates: (T & { id: string; sortOrder: number })[];
  removals: string[];
}

const pick = <T>(row: T, fields: readonly (keyof T)[]): T =>
  Object.fromEntries(fields.map((field) => [field, row[field]])) as T;

/**
 * The writes that turn the stored rows into `next`, in that order. Pure.
 * `fields` are the values compared and written; each is also its column's name.
 */
export const orderedRowChanges = <T extends object>(
  current: StoredRow<T>[],
  next: EditedRow<T>[],
  fields: readonly (keyof T)[],
): OrderedRowChanges<T> => {
  const stored = new Map(current.map((row) => [row.id, row]));
  const changes: OrderedRowChanges<T> = { inserts: [], updates: [], removals: [] };
  const kept = new Set<string>();

  next.forEach((row, sortOrder) => {
    const values = pick(row as T, fields);
    const before = row.id ? stored.get(row.id) : undefined;
    if (!before) {
      changes.inserts.push({ ...values, sortOrder });
      return;
    }
    kept.add(before.id);
    if (before.sortOrder !== sortOrder || fields.some((field) => before[field] !== values[field])) {
      changes.updates.push({ ...values, id: before.id, sortOrder });
    }
  });

  changes.removals = current.filter((row) => !kept.has(row.id)).map((row) => row.id);
  return changes;
};

const throwIfError = async (request: PromiseLike<{ error: unknown }>): Promise<void> => {
  const { error } = await request;
  if (error) throw error;
};

/** Where the rows live: their table, and the column naming their parent. */
export interface OrderedRowsTable {
  table: string;
  parentColumn: string;
}

/** Write a parent's rows in the order given. Additions first, removals last. */
export const saveOrderedRows = async <T extends object>(
  { table, parentColumn }: OrderedRowsTable,
  parentId: string,
  current: StoredRow<T>[],
  next: EditedRow<T>[],
  fields: readonly (keyof T)[],
): Promise<void> => {
  const { inserts, updates, removals } = orderedRowChanges(current, next, fields);
  const columns = (row: T, sortOrder: number) => ({ ...pick(row, fields), sort_order: sortOrder });
  if (inserts.length > 0) {
    await throwIfError(
      supabase.from(table).insert(inserts.map((row) => ({ [parentColumn]: parentId, ...columns(row, row.sortOrder) }))),
    );
  }
  await Promise.all(
    updates.map((row) => throwIfError(supabase.from(table).update(columns(row, row.sortOrder)).eq('id', row.id))),
  );
  if (removals.length > 0) await throwIfError(supabase.from(table).delete().in('id', removals));
};
