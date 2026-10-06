import { MarketplaceTasks } from "./MarketplaceTasks";

describe("Marketplace tasks", () => {
  it("runs separate IDs concurrently and serializes operations on the same ID", async () => {
    const tasks = new MarketplaceTasks();
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const order: string[] = [];
    const first = tasks.run("a", async () => {
      order.push("a1");
      await hold;
    });
    const second = tasks.run("a", async () => {
      order.push("a2");
    });
    const third = tasks.run("b", async () => {
      order.push("b");
      await hold;
    });
    await Promise.resolve();
    expect(order).toEqual(["a1", "b"]);
    expect(tasks.getSnapshot().filter((task) => task.state === "running")).toHaveLength(2);
    release();
    await Promise.all([first, second, third]);
    expect(order).toEqual(["a1", "b", "a2"]);
  });

  it("cleans failed operations and notifies once when the batch drains", async () => {
    const tasks = new MarketplaceTasks();
    tasks.onIdle = vi.fn();
    await Promise.allSettled([
      tasks.run("a", async () => {
        throw new Error("failed");
      }),
      tasks.run("b", async () => "ok"),
    ]);
    await vi.waitFor(() => expect(tasks.getSnapshot()).toHaveLength(0));
    expect(tasks.onIdle).toHaveBeenCalledTimes(1);
  });

  it("cancels queued work without executing it", async () => {
    const tasks = new MarketplaceTasks();
    let release!: () => void;
    const first = tasks.run(
      "a",
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const execute = vi.fn();
    const second = tasks.run("a", execute);
    const rejected = expect(second).rejects.toMatchObject({ name: "AbortError" });
    const queued = tasks.getSnapshot().find((task) => task.state === "queued");
    tasks.cancel(queued?.taskId ?? "");
    await rejected;
    expect(execute).not.toHaveBeenCalled();
    await Promise.resolve();
    release();
    await first;
  });
});
