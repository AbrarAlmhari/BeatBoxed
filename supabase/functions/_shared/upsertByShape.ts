import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'

/**
 * Upserts rows by spotify_id so a column left out of a row keeps its saved value.
 *
 * Sent together, rows share one column list, and any row missing a column gets
 * null for it: one row with a popularity would blank every other row's. So rows
 * with the same columns go in one request and rows with different columns in
 * another. Leave a value out rather than sending null when it's unknown.
 */
export async function upsertByShape<T>(
  admin: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
  select: string
): Promise<T[]> {
  const shapes = new Map<string, Record<string, unknown>[]>()
  for (const row of rows) {
    const shape = Object.keys(row).sort().join()
    shapes.set(shape, [...(shapes.get(shape) ?? []), row])
  }

  const saved: T[] = []
  for (const group of shapes.values()) {
    const { data, error } = await admin.from(table).upsert(group, { onConflict: 'spotify_id' }).select(select)
    if (error) throw error
    saved.push(...((data ?? []) as unknown as T[]))
  }
  return saved
}
