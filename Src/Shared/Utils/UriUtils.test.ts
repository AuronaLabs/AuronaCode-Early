import { describe, expect, it } from "vitest";
import { fileUriToPath, pathToFileUri, uriToPath } from "./UriUtils";

describe("UriUtils", () => {
  it("converts file URIs to Windows paths", () => {
    expect(uriToPath("file:///C:/repo/a.ts")).toBe("C:\\repo\\a.ts");
    expect(fileUriToPath("file:///C:/repo/%E6%B5%8B%E8%AF%95.ts")).toBe("C:\\repo\\测试.ts");
    expect(fileUriToPath("https://example.com/a.ts")).toBeNull();
  });

  it("round-trips paths through file URIs", () => {
    const path = "C:\\repo\\my file.ts";
    expect(fileUriToPath(pathToFileUri(path))).toBe(path);
  });
});
