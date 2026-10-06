export const HOT_VIEW_LIMIT = 12;

export function selectHotViews(
  previous: readonly string[],
  openIds: readonly string[],
  active: string | null,
  protectedIds: readonly string[] = [],
): string[] {
  const open = new Set(openIds);
  const protectedOpen = Array.from(new Set(protectedIds)).filter(
    (id) => open.has(id) && id !== active,
  );
  const protectedSet = new Set(protectedOpen);
  const retained = previous.filter((id) => open.has(id) && id !== active && !protectedSet.has(id));
  retained.push(...protectedOpen);
  if (active && open.has(active)) retained.push(active);
  const activeAndProtected = [
    ...retained.filter((id) => protectedSet.has(id)),
    ...(active && open.has(active) ? [active] : []),
  ];
  if (activeAndProtected.length > HOT_VIEW_LIMIT) {
    throw new Error("[resource.limit] Protected views exceed admitted capacity");
  }
  const recent = retained.filter((id) => !protectedSet.has(id) && id !== active);
  const slots = Math.max(0, HOT_VIEW_LIMIT - activeAndProtected.length);
  return [...(slots === 0 ? [] : recent.slice(-slots)), ...activeAndProtected];
}
