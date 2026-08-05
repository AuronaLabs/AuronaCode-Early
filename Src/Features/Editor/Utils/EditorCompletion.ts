import type { CompletionItem } from "../../../Foundation/Types/Lsp";

/** Filters, sorts, and bounds LSP completion items for a given typed prefix. */
export function rankCompletionItems(
  items: readonly CompletionItem[],
  prefix: string,
  limit = 100,
): CompletionItem[] {
  const normalizedPrefix = prefix.toLowerCase();
  return items
    .filter((item) => {
      const candidate = item.filterText ?? item.label;
      return !normalizedPrefix || candidate.toLowerCase().startsWith(normalizedPrefix);
    })
    .sort((left, right) =>
      (left.sortText ?? left.label).localeCompare(right.sortText ?? right.label),
    )
    .slice(0, limit);
}
