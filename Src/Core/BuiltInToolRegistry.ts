import type { I18nKey } from "../Foundation/I18n";

export type BuiltInToolKind = "language-server" | "debug-adapter";

export interface BuiltInToolDefinition {
  id: string;
  label: string;
  kind: BuiltInToolKind;
  languages: string[];
  version: string;
  runtimeKey: I18nKey;
  descriptionKey: I18nKey;
}

const tools: BuiltInToolDefinition[] = [
  {
    id: "aurona.typescript-language-server",
    label: "TypeScript Language Server",
    kind: "language-server",
    languages: ["typescript", "javascript"],
    version: "4.4.1",
    runtimeKey: "builtinTools.typescriptLanguageServer.runtime",
    descriptionKey: "builtinTools.typescriptLanguageServer.description",
  },
  {
    id: "aurona.pyright",
    label: "Pyright",
    kind: "language-server",
    languages: ["python"],
    version: "1.1.411",
    runtimeKey: "builtinTools.pyright.runtime",
    descriptionKey: "builtinTools.pyright.description",
  },
  {
    id: "aurona.python-debug",
    label: "Python Debug Adapter",
    kind: "debug-adapter",
    languages: ["python"],
    version: "DAP 1.x",
    runtimeKey: "builtinTools.pythonDebug.runtime",
    descriptionKey: "builtinTools.pythonDebug.description",
  },
];

export const BuiltInToolRegistry = {
  getAll(): readonly BuiltInToolDefinition[] {
    return tools;
  },

  getByKind(kind: BuiltInToolKind): readonly BuiltInToolDefinition[] {
    return tools.filter((tool) => tool.kind === kind);
  },
};
