import { describe, expect, it } from "vitest";
import { fileUriToPath, pathToFileUri, uriToPath } from "./UriUtils";

describe("UriUtils", () => {
  it("converts file URIs to Windows paths", () => {
    expect(uriToPath("file:///C:/repo/a.ts", "windows")).toBe("C:\\repo\\a.ts");
    expect(fileUriToPath("file:///C:/repo/%E6%B5%8B%E8%AF%95.ts", "windows")).toBe(
      "C:\\repo\\测试.ts",
    );
    expect(fileUriToPath("https://example.com/a.ts")).toBeNull();
  });

  it("handles Windows spaces, Unicode and drive letters", () => {
    expect(uriToPath("file:///C:/repo/my%20file.ts", "windows")).toBe("C:\\repo\\my file.ts");
    expect(pathToFileUri("C:\\repo\\my file.ts", "windows")).toBe("file:///C:/repo/my%20file.ts");
    expect(pathToFileUri("C:\\repo\\測試.ts", "windows")).toBe(
      "file:///C:/repo/%E6%B8%AC%E8%A9%A6.ts",
    );
  });

  it("preserves POSIX paths on macOS and Linux", () => {
    expect(uriToPath("file:///Users/user/project/main.ts", "macos")).toBe(
      "/Users/user/project/main.ts",
    );
    expect(uriToPath("file:///home/user/repo/a.ts", "linux")).toBe("/home/user/repo/a.ts");
    expect(pathToFileUri("/home/user/repo/a.ts", "linux")).toBe("file:///home/user/repo/a.ts");
    expect(pathToFileUri("/Users/user/my file.ts", "macos")).toBe(
      "file:///Users/user/my%20file.ts",
    );
  });

  it("round-trips Windows paths through file URIs", () => {
    const path = "C:\\repo\\my file.ts";
    expect(fileUriToPath(pathToFileUri(path, "windows"), "windows")).toBe(path);
  });

  it("round-trips POSIX paths through file URIs", () => {
    const path = "/home/user/项目/a file.ts";
    expect(fileUriToPath(pathToFileUri(path, "linux"), "linux")).toBe(path);
  });

  it("round-trips UNC paths on Windows", () => {
    const path = "\\\\server\\share\\repo\\a.ts";
    expect(fileUriToPath(pathToFileUri(path, "windows"), "windows")).toBe(path);
  });

  it("keeps file URIs with encoded Unicode stable", () => {
    expect(pathToFileUri("C:\\repo\\测试.ts", "windows")).toBe(
      "file:///C:/repo/%E6%B5%8B%E8%AF%95.ts",
    );
    expect(fileUriToPath("file:///C:/repo/%E6%B5%8B%E8%AF%95.ts", "windows")).toBe(
      "C:\\repo\\测试.ts",
    );
  });
});
