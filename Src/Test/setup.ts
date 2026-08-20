import "@testing-library/jest-dom/vitest";

if (typeof window !== "undefined") {
  const win = window as unknown as {
    __TAURI_INTERNALS__?: {
      metadata?: {
        currentWindow?: { label: string };
        currentWebview?: { label: string };
      };
      invoke?: () => Promise<unknown>;
      transformCallback?: () => number;
    };
  };

  const internals = win.__TAURI_INTERNALS__ ?? {};
  internals.metadata = internals.metadata ?? {
    currentWindow: { label: "main" },
    currentWebview: { label: "main" },
  };
  internals.invoke = internals.invoke ?? (() => Promise.resolve());
  internals.transformCallback = internals.transformCallback ?? (() => 0);
  win.__TAURI_INTERNALS__ = internals;
}
