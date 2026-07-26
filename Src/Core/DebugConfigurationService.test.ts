import { describe, expect, it, vi } from "vitest";
import { type DebugConfiguration, DebugConfigurationService } from "./DebugConfigurationService";

vi.mock("../Foundation/Desktop", () => ({
  desktopFileSystem: {
    exists: vi.fn(async () => true),
    mkdir: vi.fn(),
    readTextFile: vi.fn(),
    writeTextFile: vi.fn(),
  },
}));

vi.mock("../Foundation/Storage/WorkspaceStore", () => ({
  WorkspaceStore: {
    get: vi.fn(async () => ({})),
    set: vi.fn(async () => undefined),
  },
}));

const currentPythonFile: DebugConfiguration = {
  name: "Python：当前文件",
  type: "python",
  request: "launch",
  program: `$${"{file}"}`,
};

describe("DebugConfigurationService applicability", () => {
  it("follows the active Python file instead of locking the first target", () => {
    const first = DebugConfigurationService.getApplicability(
      currentPythonFile,
      "E:\\project\\first.py",
    );
    const second = DebugConfigurationService.getApplicability(
      currentPythonFile,
      "E:\\project\\second.py",
    );

    expect(first).toMatchObject({
      supported: true,
      followsActiveFile: true,
      targetPath: "E:\\project\\first.py",
    });
    expect(second).toMatchObject({
      supported: true,
      followsActiveFile: true,
      targetPath: "E:\\project\\second.py",
    });
  });

  it("rejects a non-Python active file for a Python current-file configuration", () => {
    expect(
      DebugConfigurationService.getApplicability(currentPythonFile, "E:\\project\\README.md"),
    ).toMatchObject({
      supported: false,
      followsActiveFile: true,
    });
  });

  it("keeps an explicitly configured program as a fixed target", () => {
    const fixed: DebugConfiguration = {
      ...currentPythonFile,
      name: "Python：服务",
      program: "E:\\project\\server.py",
    };

    expect(
      DebugConfigurationService.getApplicability(fixed, "E:\\project\\README.md"),
    ).toMatchObject({
      supported: true,
      followsActiveFile: false,
      targetPath: "E:\\project\\server.py",
    });
  });
});
