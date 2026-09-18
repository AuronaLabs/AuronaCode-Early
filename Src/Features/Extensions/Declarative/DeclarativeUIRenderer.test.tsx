import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DeclarativeUIRoot } from "../../../Foundation/Types/ExtensionUI";
import { isDeclarativeUI } from "../../../Foundation/Types/ExtensionUI";
import { DeclarativeUIRenderer } from "./DeclarativeUIRenderer";

describe("DeclarativeUIRenderer & UI Schema", () => {
  it("correctly identifies valid declarative UI root schemas", () => {
    const valid: DeclarativeUIRoot = {
      mode: "declarative",
      title: "测试扩展",
      components: [],
    };
    expect(isDeclarativeUI(valid)).toBe(true);
    expect(isDeclarativeUI({ mode: "webview" })).toBe(false);
    expect(isDeclarativeUI(null)).toBe(false);
  });

  it("renders native Select, Switch, Button, and Card components", () => {
    const onAction = vi.fn();
    const schema: DeclarativeUIRoot = {
      mode: "declarative",
      title: "官方原生声明式组件测试",
      description: "由 React 现代玻璃组件驱动",
      components: [
        {
          type: "card",
          id: "card_1",
          title: "环境与运行配置",
          children: [
            {
              type: "select",
              id: "envSelect",
              label: "部署目标",
              value: "dev",
              options: [
                { label: "开发环境 (Dev)", value: "dev" },
                { label: "生产环境 (Prod)", value: "prod" },
              ],
            },
            {
              type: "switch",
              id: "debugSwitch",
              label: "启用详细日志",
              checked: false,
            },
            {
              type: "button",
              id: "btnDeploy",
              label: "开始部署",
              action: "deploy:trigger",
            },
          ],
        },
      ],
    };

    render(<DeclarativeUIRenderer ui={schema} onAction={onAction} />);

    expect(screen.getByText("官方原生声明式组件测试")).toBeDefined();
    expect(screen.getByText("环境与运行配置")).toBeDefined();
    expect(screen.getByText("部署目标")).toBeDefined();
    expect(screen.getByText("启用详细日志")).toBeDefined();
    expect(screen.getByText("开始部署")).toBeDefined();

    // 点击按钮触发 action
    fireEvent.click(screen.getByText("开始部署"));
    expect(onAction).toHaveBeenCalledWith("deploy:trigger", expect.any(Object));
  });
});
