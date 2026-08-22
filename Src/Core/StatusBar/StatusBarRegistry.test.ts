import { describe, expect, it } from "vitest";
import { StatusBarRegistry } from "./StatusBarRegistry";

describe("StatusBarRegistry", () => {
  it("creates, updates, toggles visibility, and disposes status bar items correctly", () => {
    const item = StatusBarRegistry.createItem({
      id: "test.item.1",
      alignment: "left",
      priority: 100,
      text: "Ready",
      tooltip: "System ready",
    });

    expect(item.text).toBe("Ready");
    expect(item.tooltip).toBe("System ready");
    expect(item.visible).toBe(true);

    let leftItems = StatusBarRegistry.getLeftItems();
    expect(leftItems.some((i) => i.id === "test.item.1")).toBe(true);

    // 修改内容
    item.text = "Building...";
    expect(item.text).toBe("Building...");

    // 隐藏
    item.hide();
    expect(item.visible).toBe(false);
    leftItems = StatusBarRegistry.getLeftItems();
    expect(leftItems.some((i) => i.id === "test.item.1")).toBe(false);

    // 重新显示
    item.show();
    expect(item.visible).toBe(true);

    // 销毁
    item.dispose();
    leftItems = StatusBarRegistry.getLeftItems();
    expect(leftItems.some((i) => i.id === "test.item.1")).toBe(false);
  });

  it("sorts items by priority in descending order", () => {
    const itemA = StatusBarRegistry.createItem({
      id: "test.item.a",
      alignment: "right",
      priority: 10,
      text: "Item A",
    });

    const itemB = StatusBarRegistry.createItem({
      id: "test.item.b",
      alignment: "right",
      priority: 50,
      text: "Item B",
    });

    const rightItems = StatusBarRegistry.getRightItems();
    const indexA = rightItems.findIndex((i) => i.id === "test.item.a");
    const indexB = rightItems.findIndex((i) => i.id === "test.item.b");

    expect(indexB).toBeLessThan(indexA);

    itemA.dispose();
    itemB.dispose();
  });
});
