import "@testing-library/jest-dom/vitest";

// jsdom 未实现 ResizeObserver（FilterChips/EditorTabBar 等溢出检测依赖它）
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

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
