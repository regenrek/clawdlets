export async function mapWithConcurrency<TItem, TResult>(params: {
  items: readonly TItem[];
  concurrency: number;
  fn: (item: TItem, index: number) => Promise<TResult>;
}): Promise<TResult[]> {
  const items = params.items;
  const max = Math.max(1, Math.floor(params.concurrency || 1));
  const out = new Array<TResult>(items.length);

  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(max, items.length) }, async () => {
    while (true) {
      const idx = nextIndex;
      nextIndex += 1;
      if (idx >= items.length) return;
      out[idx] = await params.fn(items[idx]!, idx);
    }
  });

  await Promise.all(workers);
  return out;
}

