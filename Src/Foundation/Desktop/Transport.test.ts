import { describe, expect, it } from "vitest";
import { normalizeDesktopError } from "./Transport";

describe("normalizeDesktopError", () => {
  it("preserves backend error codes and redacts messages and diagnostics", () => {
    const error = normalizeDesktopError(
      "git_status",
      "[workspace.boundary] https://alice:secret@host.test/repo?token=abc#private Bearer secret-value password=hidden",
    );
    expect(error.domain).toBe("workspace");
    expect(error.code).toBe("workspace.boundary");
    expect(error.message).toContain("host.test/repo");
    for (const secret of ["alice", "secret", "abc", "private", "hidden"]) {
      expect(error.message).not.toContain(secret);
      expect(error.cause).not.toContain(secret);
    }
  });

  it("redacts structured errors without changing the machine-readable code", () => {
    const error = normalizeDesktopError("ai_responses_send", {
      domain: "ai",
      code: "authorization_revoked",
      message: "api_key=value",
      cause: "Basic c2VjcmV0",
      recoverable: true,
    });
    expect(error.code).toBe("authorization_revoked");
    expect(error.message).toBe("api_key=[redacted]");
    expect(error.cause).toBe("Basic [redacted]");
  });

  it("preserves structured Aurona Account errors for the user and diagnostics", () => {
    const error = normalizeDesktopError("account_auth_start", {
      code: "authorization_denied",
      userMessage: "用户取消了授权。",
      detail: "provider returned access_denied",
      recoverable: true,
    });

    expect(error.domain).toBe("account");
    expect(error.code).toBe("authorization_denied");
    expect(error.message).toBe("用户取消了授权。");
    expect(error.cause).toBe("provider returned access_denied");
  });
});
