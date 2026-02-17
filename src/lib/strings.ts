export function toKeywordVariants(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) return [];

  const lower = trimmed.toLowerCase();
  const condensed = lower.replace(/[\s_-]+/g, "");
  return condensed === lower ? [lower] : [lower, condensed];
}

export function uniqueStrings(
  values: Array<string | undefined | null>,
  max = 200,
): string[] {
  const set = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    if (!value) continue;
    const variants = toKeywordVariants(value);
    for (const v of variants) {
      if (set.has(v)) continue;
      set.add(v);
      out.push(v);
      if (out.length >= max) return out;
    }
  }

  return out;
}
