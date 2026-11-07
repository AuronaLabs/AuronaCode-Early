import { describe, expect, it } from "vitest";
import { resolveWorkspacePath } from "./WorkspacePath";

describe("workspace-relative paths", () => {
  it("handles dots, parent segments and empty paths without changing their meaning", () => {
    expect(resolveWorkspacePath("C:/project", ".", true)).toBe("C:/project");
    expect(resolveWorkspacePath("C:/project", "", true)).toBe("C:/project");
    expect(resolveWorkspacePath("C:/project", "src/../main.ts", true)).toBe("C:/project/main.ts");
  });
  it.each(["../secret", "C:/other/file", "C:relative", "a\0b"])("rejects %s", (input) => {
    expect(() => resolveWorkspacePath("C:/project", input, true)).toThrow();
  });
  it("preserves filesystem roots, UNC roots and platform-specific case", () => {
    expect(resolveWorkspacePath("/", "etc/config", false)).toBe("/etc/config");
    expect(resolveWorkspacePath("C:/", ".", true)).toBe("C:/");
    expect(resolveWorkspacePath("C:/Project", "c:/project/main.ts", true)).toBe(
      "c:/project/main.ts",
    );
    expect(resolveWorkspacePath("//server/share", "a.ts", true)).toBe("//server/share/a.ts");
    expect(() => resolveWorkspacePath("/Project", "/project/a.ts", false)).toThrow();
    expect(() => resolveWorkspacePath("/project", "/project-other/a.ts", false)).toThrow();
  });
});
