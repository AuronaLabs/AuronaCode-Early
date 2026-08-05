import { describe, expect, it } from "vitest";
import { normalizeDesktopError } from "./Transport";

describe("normalizeDesktopError", () => {
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
