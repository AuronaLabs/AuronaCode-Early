import { describe, expect, it, vi } from "vitest";
import { DisposableScope } from "./DisposableScope";

describe("DisposableScope", () => {
  it("releases in reverse order exactly once and immediately releases late resources", () => {
    for (let iteration = 0; iteration < 20; iteration++) {
      const scope = new DisposableScope();
      const order: number[] = [];
      scope.add(() => order.push(1));
      scope.add(() => order.push(2));
      scope.dispose();
      scope.dispose();
      scope.add(() => order.push(3));
      expect(order).toEqual([2, 1, 3]);
      expect(scope.isDisposed).toBe(true);
    }
  });

  it("cleans remaining resources even when one disposer throws", () => {
    const scope = new DisposableScope();
    const dispose = vi.fn();
    scope.add(dispose);
    scope.add(() => {
      throw new Error("failure");
    });
    expect(() => scope.dispose()).toThrow(AggregateError);
    expect(dispose).toHaveBeenCalledOnce();
    expect(() => scope.dispose()).not.toThrow();
  });
});
