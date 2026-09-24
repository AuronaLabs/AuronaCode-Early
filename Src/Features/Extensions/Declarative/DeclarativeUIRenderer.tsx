import type React from "react";
import { useState } from "react";
import type {
  DeclarativeCard,
  DeclarativeComponent,
  DeclarativeSelect,
  DeclarativeSwitch,
  DeclarativeUIRoot,
} from "../../../Foundation/Types/ExtensionUI";
import { Button } from "../../../UI/Components/Button";
import { Input } from "../../../UI/Components/Input";
import { Select } from "../../../UI/Components/Select";
import { Switch } from "../../../UI/Components/Switch";
import { GlassContainer } from "../../../UI/Core/GlassManager";

interface DeclarativeUIRendererProps {
  ui: DeclarativeUIRoot;
  onAction?: (actionId: string, payload?: unknown) => void;
}

export function DeclarativeUIRenderer({ ui, onAction }: DeclarativeUIRendererProps) {
  // 维护组件的局部交互状态 (如 Input, Select, Switch)
  const [componentState, setComponentState] = useState<Record<string, unknown>>({});

  const updateState = (id: string, value: unknown) => {
    setComponentState((prev) => ({ ...prev, [id]: value }));
  };

  const renderComponent = (comp: DeclarativeComponent, index: number): React.ReactNode => {
    switch (comp.type) {
      case "card": {
        const card = comp as DeclarativeCard;
        return (
          <GlassContainer
            key={card.id ?? `card_${index}`}
            layer="raised"
            className="flex flex-col gap-3 rounded-surface p-4"
          >
            {card.title && (
              <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-2 mb-1">
                <div className="flex flex-col">
                  <h4 className="text-[13.5px] font-semibold text-[var(--color-text-highlight)]">
                    {card.title}
                  </h4>
                  {card.subtitle && (
                    <span className="text-[11px] text-[var(--color-text-muted)]">
                      {card.subtitle}
                    </span>
                  )}
                </div>
              </div>
            )}
            <div className="flex flex-col gap-2.5">
              {card.children.map((child, cIdx) => renderComponent(child, cIdx))}
            </div>
          </GlassContainer>
        );
      }

      case "select": {
        const select = comp as DeclarativeSelect;
        const currentVal = (componentState[select.id] as string | undefined) ?? select.value ?? "";
        return (
          <div
            key={select.id}
            className="flex items-center justify-between gap-3 py-1 text-[12.5px]"
          >
            {select.label && (
              <span className="font-medium text-[var(--color-text-primary)]">{select.label}</span>
            )}
            <div className="w-44 shrink-0">
              <Select
                value={currentVal}
                disabled={select.disabled}
                onChange={(val) => {
                  updateState(select.id, val);
                  onAction?.(`change:${select.id}`, val);
                }}
                options={select.options.map((opt) => ({
                  label: opt.label,
                  value: opt.value,
                  disabled: opt.disabled,
                }))}
              />
            </div>
          </div>
        );
      }

      case "switch": {
        const sw = comp as DeclarativeSwitch;
        const isChecked = (componentState[sw.id] as boolean | undefined) ?? sw.checked ?? false;
        return (
          <div key={sw.id} className="flex items-center justify-between gap-3 py-1.5 text-[12.5px]">
            <div className="flex flex-col gap-0.5">
              <span className="font-medium text-[var(--color-text-primary)]">{sw.label}</span>
              {sw.description && (
                <span className="text-[11px] text-[var(--color-text-muted)]">{sw.description}</span>
              )}
            </div>
            <Switch
              checked={isChecked}
              disabled={sw.disabled}
              onCheckedChange={(checked) => {
                updateState(sw.id, checked);
                onAction?.(`toggle:${sw.id}`, checked);
              }}
            />
          </div>
        );
      }

      case "button": {
        return (
          <Button
            key={comp.id}
            variant={comp.variant ?? "primary"}
            disabled={comp.disabled}
            className="h-8 text-[12px] px-3.5"
            onClick={() => onAction?.(comp.action, componentState)}
          >
            {comp.label}
          </Button>
        );
      }

      case "input": {
        const currentText = (componentState[comp.id] as string | undefined) ?? comp.value ?? "";
        return (
          <div key={comp.id} className="flex flex-col gap-1 py-1">
            {comp.label && (
              <span className="text-[12px] font-medium text-[var(--color-text-primary)]">
                {comp.label}
              </span>
            )}
            <Input
              fullWidth
              inputSize="md"
              type={comp.inputType ?? "text"}
              value={currentText}
              disabled={comp.disabled}
              placeholder={comp.placeholder}
              onChange={(e) => {
                updateState(comp.id, e.target.value);
                onAction?.(`input:${comp.id}`, e.target.value);
              }}
            />
          </div>
        );
      }

      case "badge": {
        // 徽章色收敛语义令牌：命名色键不变（插件协议兼容），色值走 --Status*/--Viz* 令牌
        const colorStyles: Record<string, string> = {
          blue: "bg-[var(--StatusInfo)]/15 text-[var(--StatusInfo)] border-[var(--StatusInfo)]/20",
          green:
            "bg-[var(--StatusSuccess)]/15 text-[var(--StatusSuccess)] border-[var(--StatusSuccess)]/20",
          amber:
            "bg-[var(--StatusWarning)]/15 text-[var(--StatusWarning)] border-[var(--StatusWarning)]/20",
          purple: "bg-[var(--VizIndigo)]/15 text-[var(--VizIndigo)] border-[var(--VizIndigo)]/20",
          neutral:
            "bg-[var(--color-text-muted)]/15 text-[var(--color-text-muted)] border-[var(--border-subtle)]",
        };
        const style = colorStyles[comp.color ?? "blue"] ?? colorStyles.blue;
        return (
          <span
            key={comp.id ?? `badge_${index}`}
            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-medium border ${style}`}
          >
            {comp.text}
          </span>
        );
      }

      case "text": {
        const variants: Record<string, string> = {
          title: "text-[14px] font-bold text-[var(--color-text-highlight)]",
          subtitle: "text-[12.5px] font-semibold text-[var(--color-text-primary)]",
          body: "text-[12px] text-[var(--color-text-muted)] leading-relaxed",
          caption: "text-[11px] text-[var(--color-text-muted)]",
          code: "text-[11.5px] font-mono bg-[var(--material-panel)] px-1.5 py-0.5 rounded text-[var(--color-text-primary)]",
        };
        return (
          <div key={comp.id ?? `text_${index}`} className={variants[comp.variant ?? "body"]}>
            {comp.content}
          </div>
        );
      }

      case "progress": {
        return (
          <div key={comp.id ?? `progress_${index}`} className="flex flex-col gap-1.5 py-1">
            {comp.label && (
              <div className="flex justify-between text-[11px]">
                <span className="text-[var(--color-text-muted)]">{comp.label}</span>
                <span className="font-semibold text-[var(--color-text-highlight)]">
                  {Math.round(comp.progress)}%
                </span>
              </div>
            )}
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--material-panel)]">
              <div
                className="h-full bg-gradient-to-r from-blue-500 to-emerald-400 transition-all duration-300"
                style={{ width: `${Math.min(100, Math.max(0, comp.progress))}%` }}
              />
            </div>
          </div>
        );
      }

      case "grid": {
        return (
          <div
            key={comp.id ?? `grid_${index}`}
            className="grid gap-2.5"
            style={{
              gridTemplateColumns: `repeat(${comp.columns || 2}, minmax(0, 1fr))`,
            }}
          >
            {comp.children.map((child, cIdx) => renderComponent(child, cIdx))}
          </div>
        );
      }

      case "container": {
        const isHorizontal = comp.direction === "horizontal";
        return (
          <div
            key={comp.id ?? `container_${index}`}
            className={`flex ${isHorizontal ? "flex-row items-center" : "flex-col"} gap-2.5`}
          >
            {comp.children.map((child, cIdx) => renderComponent(child, cIdx))}
          </div>
        );
      }

      case "separator": {
        return (
          <div
            key={comp.id ?? `sep_${index}`}
            className="h-px w-full bg-[var(--border-subtle)] my-1"
          />
        );
      }

      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col gap-3 p-3 w-full animate-in fade-in duration-200">
      {ui.title && (
        <div className="flex flex-col gap-1 px-1">
          <h3 className="text-[15px] font-bold text-[var(--color-text-highlight)]">{ui.title}</h3>
          {ui.description && (
            <p className="text-[12px] text-[var(--color-text-muted)]">{ui.description}</p>
          )}
        </div>
      )}
      <div className="flex flex-col gap-3">
        {ui.components.map((comp, idx) => renderComponent(comp, idx))}
      </div>
    </div>
  );
}
