export type BuiltInToolKind = "language-server" | "debug-adapter";

export interface BuiltInToolDefinition {
  id: string;
  label: string;
  kind: BuiltInToolKind;
  languages: string[];
  version: string;
  runtime: string;
  description: string;
}

const tools: BuiltInToolDefinition[] = [
  {
    id: "aurona.typescript-language-server",
    label: "TypeScript Language Server",
    kind: "language-server",
    languages: ["typescript", "javascript"],
    version: "4.4.1",
    runtime: "内置 Node Runtime",
    description: "为 TypeScript 与 JavaScript 提供补全、诊断、跳转、重命名和格式化。",
  },
  {
    id: "aurona.pyright",
    label: "Pyright",
    kind: "language-server",
    languages: ["python"],
    version: "1.1.411",
    runtime: "内置 Node Runtime",
    description: "为 Python 提供类型分析、补全、Hover、跳转、引用和重命名。",
  },
  {
    id: "aurona.python-debug",
    label: "Python Debug Adapter",
    kind: "debug-adapter",
    languages: ["python"],
    version: "DAP 1.x",
    runtime: "Python + debugpy",
    description:
      "Aurona 已内置 DAP 会话、断点和调试视图；通过所选 Python 环境启动真实 Adapter，缺少 debugpy 时提供安全的一键安装入口。",
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
