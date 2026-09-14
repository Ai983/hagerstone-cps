/**
 * Run a Supabase `.in(column, ids)` query in bounded batches and merge the rows.
 *
 * Putting hundreds of ids into a single `?col=in.(id1,id2,…)` URL produces
 * 15–21 KB URLs. Corporate firewalls, antivirus web protection and ISP proxies
 * commonly cap request URLs around 8 KB — they reject such requests or, worse,
 * hold them open without answering. With no client timeout that hangs the page
 * on skeletons forever. Batching keeps every URL small so the request always
 * gets through.
 *
 * Usage — a drop-in for `await supabase.from(t).select(s).in(col, ids)`:
 *
 *   const { data, error } = await inChunks<Row>(
 *     ids,
 *     (chunk) => supabase.from(t).select(s).in(col, chunk),
 *   );
 *
 * The `build` callback receives one id-chunk and must return the query for it
 * (with all the same filters). Chunks run in parallel; rows are concatenated and
 * the first error (if any) is surfaced. Ids are de-duplicated first.
 */
export async function inChunks<T>(
  ids: readonly (string | number)[],
  build: (chunk: (string | number)[]) => PromiseLike<{ data: T[] | null; error: unknown }>,
  chunkSize = 100,
): Promise<{ data: T[]; error: unknown }> {
  const unique = Array.from(new Set(ids));
  if (unique.length === 0) return { data: [], error: null };

  const chunks: (string | number)[][] = [];
  for (let i = 0; i < unique.length; i += chunkSize) {
    chunks.push(unique.slice(i, i + chunkSize));
  }

  const results = await Promise.all(chunks.map((c) => build(c)));
  const error = results.find((r) => r.error)?.error ?? null;
  const data = results.flatMap((r) => r.data ?? []);
  return { data, error };
}
