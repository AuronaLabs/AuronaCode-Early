import { describe, expect, it, vi } from "vitest";
import { EventBus } from ".";

describe("EventBus", () => {
  it("does not skip later listeners when a listener unsubscribes during emit", () => {
    const calls: string[] = [];
    let unsubscribeFirst: () => void = () => {};
    unsubscribeFirst = EventBus.on("app:open-file", () => {
      calls.push("first");
      unsubscribeFirst();
    });
    const unsubscribeSecond = EventBus.on("app:open-file", () => calls.push("second"));

    EventBus.emit("app:open-file");
    EventBus.emit("app:open-file");
    unsubscribeSecond();

    expect(calls).toEqual(["first", "second", "second"]);
  });

  it("defers listeners registered during emit until the next emit", () => {
    const late = vi.fn();
    let unsubscribeLate: () => void = () => {};
    const unsubscribe = EventBus.on("app:open-folder", () => {
      unsubscribeLate = EventBus.on("app:open-folder", late);
    });

    EventBus.emit("app:open-folder");
    expect(late).not.toHaveBeenCalled();
    EventBus.emit("app:open-folder");
    expect(late).toHaveBeenCalledOnce();
    unsubscribe();
    unsubscribeLate();
  });
});
