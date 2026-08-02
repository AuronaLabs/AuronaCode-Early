import { type ReactNode, useEffect, useState } from "react";
import { DebugConfigurationService } from "../../Core/DebugConfigurationService";
import { DebugService } from "../../Core/DebugService";
import { type DebugVariable, useDebugStore } from "../../State/useDebugStore";
import { useWorkbenchStore } from "../../State/useWorkspaceStore";
import { Button } from "../../UI/Components/Button";
import {
  GlassList,
  glassListHeaderStyles,
  glassListRowStyles,
} from "../../UI/Components/GlassList";
import { Select } from "../../UI/Components/Select";
import { Tooltip } from "../../UI/Feedback/Tooltip";
import { Icons } from "../../UI/Icons/IconManager";
import { SidebarPageHeader } from "../../UI/Layouts/SidebarPage";

export function DebugPanel() {
  const debug = useDebugStore();
  const activeFile = useWorkbenchStore((state) => {
    const tab = state.tabs.find((item) => item.id === state.activeTabId);
    return tab?.type === "file" ? tab.path : undefined;
  });

  useEffect(() => {
    void DebugService.initialize(activeFile);
  }, [activeFile]);

  const selected = debug.configurations.find(
    (configuration) => configuration.name === debug.selectedConfiguration,
  );
  const running = ["starting", "running", "paused", "stopping"].includes(debug.state);
  const applicability = selected
    ? DebugConfigurationService.getApplicability(selected, activeFile)
    : null;
  const showContextEmpty = !running && !debug.error && (!activeFile || !applicability?.supported);

  const start = () => {
    if (selected) void DebugService.start(selected, activeFile);
  };

  return (
    <section className="flex h-full min-h-0 flex-col">
      <SidebarPageHeader
        title="运行和调试"
        actions={
          <>
            {debug.configurations.length > 0 && (
              <HeaderAction
                label="编辑调试配置"
                icon={<Icons.FileCode size={16} />}
                onClick={() => {
                  const path = DebugConfigurationService.getConfigurationPath();
                  if (path) useWorkbenchStore.getState().openFile(path);
                }}
              />
            )}
            <HeaderAction
              label="刷新调试配置"
              icon={<Icons.Refresh size={16} />}
              onClick={() => void DebugService.reloadConfigurations(activeFile)}
            />
          </>
        }
      />

      {showContextEmpty ? (
        <DebugContextEmpty hasFile={Boolean(activeFile)} />
      ) : (
        <>
          <div className="shrink-0 px-[var(--PanelPaddingX)] pb-3 pt-2">
            <div className="flex gap-2">
              {debug.configurations.length ? (
                <Select
                  ariaLabel="调试配置"
                  className="min-w-0 flex-1"
                  value={debug.selectedConfiguration ?? debug.configurations[0].name}
                  options={debug.configurations.map((configuration) => ({
                    value: configuration.name,
                    label: debugConfigurationLabel(configuration.type, configuration.name),
                    disabled: !DebugConfigurationService.getApplicability(configuration, activeFile)
                      .supported,
                    disabledReason: DebugConfigurationService.getApplicability(
                      configuration,
                      activeFile,
                    ).reason,
                  }))}
                  onChange={(selectedConfiguration) => debug.set({ selectedConfiguration })}
                />
              ) : (
                <div className="flex h-8 min-w-0 flex-1 items-center px-1 text-[11px] text-[var(--TextMuted)]">
                  未检测到可调试项目
                </div>
              )}
              <Button
                size="icon"
                variant={running ? "danger" : "primary"}
                aria-label={running ? "停止调试" : "开始调试"}
                disabled={
                  !selected ||
                  !applicability?.supported ||
                  debug.state === "starting" ||
                  debug.state === "stopping" ||
                  debug.dependencyState === "checking" ||
                  debug.dependencyState === "installing"
                }
                onClick={() => (running ? void DebugService.stop() : start())}
              >
                {running ? <Icons.Stop size={15} /> : <Icons.Play size={15} />}
              </Button>
            </div>
            <SessionStatus state={debug.state} />
          </div>

          {(debug.state === "running" || debug.state === "paused") && (
            <DebugToolbar paused={debug.state === "paused"} />
          )}

          <div className="min-h-0 flex-1 overflow-y-auto pb-3 no-scrollbar">
            {(debug.dependencyState === "missing" ||
              debug.dependencyState === "installing" ||
              debug.dependencyState === "failed") && (
              <DependencyPrompt
                message={debug.dependencyMessage}
                busy={debug.dependencyState === "installing"}
                onInstall={async () => {
                  const installed = await DebugService.installPythonDebugpy();
                  if (installed) start();
                }}
              />
            )}
            {debug.error && (
              <div className="mx-3 mb-2 rounded-xl bg-red-500/10 px-3 py-2.5 text-[11px] leading-5 text-red-500">
                {debug.error}
              </div>
            )}
            {!debug.configurations.length && !debug.error && (
              <div className="flex flex-col items-center gap-3 px-7 py-10 text-center text-[11px] leading-5 text-[var(--TextMuted)]">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[var(--GlassSurface-Elevated)] text-[var(--TextMuted)]">
                  <Icons.Debug size={22} stroke={1.4} />
                </div>
                <div>
                  <div className="font-medium text-[var(--TextPrimary)]">打开可调试的代码文件</div>
                  <p className="mt-1">
                    Aurona 会识别项目并生成可编辑的启动配置，无需手工创建基础配置。
                  </p>
                </div>
              </div>
            )}

            <GlassList className="mx-3 mt-2">
              <DebugSection
                title="调用栈"
                icon={<Icons.Stack size={14} />}
                count={debug.stackFrames.length}
                empty="程序暂停后，这里会显示当前执行位置和调用链。"
              >
                {debug.stackFrames.map((frame) => (
                  <button
                    type="button"
                    key={frame.id}
                    className={`${glassListRowStyles} w-full min-w-0 flex-col items-start text-left ${
                      frame.id === debug.selectedFrameId ? "bg-[var(--GlassSurface-Base)]" : ""
                    }`}
                    onClick={() => {
                      void DebugService.selectFrame(frame.id);
                      if (!frame.source?.path) return;
                      useWorkbenchStore.getState().openFile(frame.source.path);
                      useWorkbenchStore.getState().requestReveal(frame.source.path, frame.line);
                    }}
                  >
                    {frame.id === debug.selectedFrameId && (
                      <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-[var(--AccentPrimary)]" />
                    )}
                    <span className="truncate text-[12px] font-medium text-[var(--TextPrimary)]">
                      {frame.name}
                    </span>
                    <span className="mt-0.5 truncate text-[10px] text-[var(--TextMuted)]">
                      {fileName(frame.source?.path)} · {frame.line}:{frame.column}
                    </span>
                  </button>
                ))}
              </DebugSection>

              <DebugSection
                title="变量"
                icon={<Icons.Variables size={14} />}
                count={debug.scopes.reduce(
                  (count, scope) =>
                    count + (debug.variablesByReference[scope.variablesReference]?.length ?? 0),
                  0,
                )}
                empty="选择暂停的栈帧后，这里会显示当前作用域变量。"
              >
                {debug.scopes.map((scope) => (
                  <VariableScope
                    key={scope.variablesReference}
                    name={scope.name}
                    variables={debug.variablesByReference[scope.variablesReference] ?? []}
                    variablesByReference={debug.variablesByReference}
                    loadingReferences={debug.loadingVariableReferences}
                  />
                ))}
              </DebugSection>

              <DebugSection
                title="断点"
                icon={<Icons.Breakpoint size={14} />}
                count={debug.breakpoints.length}
                empty="点击编辑器行号左侧即可添加断点。"
              >
                {debug.breakpoints.map((breakpoint) => (
                  <div
                    key={`${breakpoint.path}:${breakpoint.line}`}
                    className={`${glassListRowStyles} min-w-0 gap-2`}
                  >
                    <span
                      className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                        breakpoint.verified === false
                          ? "border border-red-500"
                          : "bg-red-500 shadow-[0_0_0_2px_rgba(239,68,68,0.12)]"
                      }`}
                    />
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => {
                        useWorkbenchStore.getState().openFile(breakpoint.path);
                        useWorkbenchStore
                          .getState()
                          .requestReveal(breakpoint.path, breakpoint.line);
                      }}
                    >
                      <div className="truncate text-[11px] font-medium text-[var(--TextPrimary)]">
                        {fileName(breakpoint.path)}
                      </div>
                      <div className="truncate text-[9px] text-[var(--TextMuted)]">
                        第 {breakpoint.line} 行
                      </div>
                    </button>
                    <button
                      type="button"
                      aria-label={`移除 ${fileName(breakpoint.path)} 第 ${breakpoint.line} 行断点`}
                      className="rounded-md p-1 text-[var(--TextMuted)] opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100 focus-visible:opacity-100"
                      onClick={() => {
                        debug.toggleBreakpoint(breakpoint.path, breakpoint.line);
                        void DebugService.syncBreakpoints();
                      }}
                    >
                      <Icons.Close size={12} />
                    </button>
                  </div>
                ))}
              </DebugSection>
            </GlassList>
          </div>
        </>
      )}
    </section>
  );
}

function HeaderAction({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <Tooltip content={label} placement="bottom">
      <button
        type="button"
        aria-label={label}
        className="rounded-lg p-1.5 text-[var(--TextMuted)] transition-colors hover:bg-[var(--GlassHover)] hover:text-[var(--TextHighlight)]"
        onClick={onClick}
      >
        {icon}
      </button>
    </Tooltip>
  );
}

function SessionStatus({ state }: { state: ReturnType<typeof useDebugStore.getState>["state"] }) {
  const stateLabels = {
    idle: "等待启动",
    starting: "正在启动调试器",
    running: "程序正在运行 · 可暂停查看调用栈",
    paused: "已在断点处暂停",
    stopping: "正在结束会话",
    failed: "调试会话启动失败",
  };
  return (
    <div className="mt-2 flex items-center gap-1.5 px-1 text-[10px] text-[var(--TextMuted)]">
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          state === "running"
            ? "bg-emerald-500"
            : state === "paused"
              ? "bg-amber-500"
              : state === "failed"
                ? "bg-red-500"
                : "bg-[var(--TextMuted)]/50"
        }`}
      />
      {stateLabels[state]}
    </div>
  );
}

function DebugToolbar({ paused }: { paused: boolean }) {
  const actions = paused
    ? [
        { command: "continue" as const, label: "继续", icon: <Icons.Play size={15} /> },
        { command: "next" as const, label: "单步跳过", icon: <Icons.StepOver size={15} /> },
        { command: "stepIn" as const, label: "单步进入", icon: <Icons.StepIn size={15} /> },
        { command: "stepOut" as const, label: "单步跳出", icon: <Icons.StepOut size={15} /> },
      ]
    : [{ command: "pause" as const, label: "暂停", icon: <Icons.Pause size={15} /> }];
  return (
    <div className="flex shrink-0 items-center gap-0.5 border-y border-[var(--GlassBorder)] px-3 py-1.5">
      {actions.map((action) => (
        <Tooltip key={action.command} content={action.label} placement="bottom">
          <button
            type="button"
            aria-label={action.label}
            onClick={() => void DebugService.request(action.command)}
            className="rounded-lg p-1.5 text-[var(--TextMuted)] transition-colors hover:bg-[var(--GlassHover)] hover:text-[var(--TextHighlight)]"
          >
            {action.icon}
          </button>
        </Tooltip>
      ))}
      <span className="mx-1 h-4 w-px bg-[var(--GlassBorder)]" />
      <Tooltip content="停止调试" placement="bottom">
        <button
          type="button"
          aria-label="停止调试"
          onClick={() => void DebugService.stop()}
          className="rounded-lg p-1.5 text-red-500 transition-colors hover:bg-red-500/10"
        >
          <Icons.Stop size={15} />
        </button>
      </Tooltip>
    </div>
  );
}

function VariableScope({
  name,
  variables,
  variablesByReference,
  loadingReferences,
}: {
  name: string;
  variables: DebugVariable[];
  variablesByReference: Record<number, DebugVariable[]>;
  loadingReferences: number[];
}) {
  const [expandedReferences, setExpandedReferences] = useState<Set<number>>(() => new Set());
  const toggleReference = (reference: number) => {
    setExpandedReferences((current) => {
      const next = new Set(current);
      if (next.has(reference)) next.delete(reference);
      else next.add(reference);
      return next;
    });
    void DebugService.loadVariables(reference);
  };

  return (
    <div className="overflow-hidden rounded-lg bg-[var(--GlassSurface-Base)]">
      <div className="flex h-7 items-center gap-2 px-2.5 text-[10px] font-semibold text-[var(--TextMuted)]">
        <Icons.ChevronRight size={11} className="rotate-90" />
        <span className="truncate">{name}</span>
        <span className="ml-auto font-normal">{variables.length}</span>
      </div>
      <div className="pb-1">
        {variables.map((variable) => (
          <VariableRow
            key={`${variable.evaluateName ?? variable.name}-${variable.value}-${variable.variablesReference}`}
            variable={variable}
            depth={0}
            variablesByReference={variablesByReference}
            loadingReferences={loadingReferences}
            expandedReferences={expandedReferences}
            onToggle={toggleReference}
          />
        ))}
      </div>
    </div>
  );
}

function VariableRow({
  variable,
  depth,
  variablesByReference,
  loadingReferences,
  expandedReferences,
  onToggle,
}: {
  variable: DebugVariable;
  depth: number;
  variablesByReference: Record<number, DebugVariable[]>;
  loadingReferences: number[];
  expandedReferences: Set<number>;
  onToggle: (reference: number) => void;
}) {
  const expandable = variable.variablesReference > 0;
  const expanded = expandable && expandedReferences.has(variable.variablesReference);
  const loading = loadingReferences.includes(variable.variablesReference);
  const children = variablesByReference[variable.variablesReference] ?? [];
  return (
    <>
      <button
        type="button"
        className="grid h-7 w-full min-w-0 grid-cols-[minmax(70px,0.8fr)_minmax(0,1.2fr)] items-center gap-2 rounded-md pr-2 text-left text-[10px] hover:bg-[var(--GlassHover)] disabled:cursor-default"
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        disabled={!expandable}
        onClick={() => expandable && onToggle(variable.variablesReference)}
        title={variable.evaluateName ?? `${variable.name}: ${variable.value}`}
      >
        <span className="flex min-w-0 items-center gap-1">
          <span className="flex h-3 w-3 shrink-0 items-center justify-center text-[var(--TextMuted)]">
            {expandable && (
              <Icons.ChevronRight
                size={10}
                className={`transition-transform ${expanded ? "rotate-90" : ""}`}
              />
            )}
          </span>
          <span className="truncate font-medium text-[var(--TextPrimary)]">{variable.name}</span>
        </span>
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-mono text-[var(--TextMuted)]">
            {loading && expanded ? "正在读取…" : variable.value}
          </span>
          {variable.type && (
            <span className="shrink-0 text-[9px] text-[var(--TextMuted)]/70">{variable.type}</span>
          )}
        </span>
      </button>
      {expanded &&
        children.map((child) => (
          <VariableRow
            key={`${variable.variablesReference}-${child.evaluateName ?? child.name}-${child.value}-${child.variablesReference}`}
            variable={child}
            depth={depth + 1}
            variablesByReference={variablesByReference}
            loadingReferences={loadingReferences}
            expandedReferences={expandedReferences}
            onToggle={onToggle}
          />
        ))}
    </>
  );
}

function DependencyPrompt({
  message,
  busy,
  onInstall,
}: {
  message: string | null;
  busy: boolean;
  onInstall: () => void;
}) {
  return (
    <div className="mx-3 mb-3 rounded-xl border border-amber-500/20 bg-amber-500/8 p-3">
      <div className="flex items-start gap-2.5">
        <Icons.Download className="mt-0.5 shrink-0 text-amber-500" size={15} />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold text-[var(--TextPrimary)]">
            需要 Python 调试组件
          </div>
          <p className="mt-1 break-words text-[10px] leading-4 text-[var(--TextMuted)]">
            {message}
          </p>
          <Button className="mt-2" size="sm" disabled={busy} onClick={onInstall}>
            {busy ? "正在安装…" : "安装并继续"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function DebugSection({
  title,
  icon,
  count,
  empty,
  children,
}: {
  title: string;
  icon: ReactNode;
  count: number;
  empty: string;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(true);
  return (
    <section className="border-b border-[var(--GlassBorder)] last:border-b-0">
      <button
        type="button"
        className={`${glassListHeaderStyles} w-full gap-2 text-left font-semibold`}
        onClick={() => setExpanded((value) => !value)}
      >
        <Icons.ChevronRight
          size={12}
          className={`transition-transform ${expanded ? "rotate-90" : ""}`}
        />
        <span className="text-[var(--TextMuted)]">{icon}</span>
        <span>{title}</span>
        <span className="ml-auto min-w-5 rounded-full bg-[var(--GlassSurface-Elevated)] px-1.5 py-0.5 text-center text-[9px] font-normal text-[var(--TextMuted)]">
          {count}
        </span>
      </button>
      {expanded &&
        (count > 0 ? (
          <div className="space-y-0.5 p-1.5">{children}</div>
        ) : (
          <div className="px-4 py-3 text-[10px] leading-4 text-[var(--TextMuted)]">{empty}</div>
        ))}
    </section>
  );
}

function DebugContextEmpty({ hasFile }: { hasFile: boolean }) {
  return (
    <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center gap-5 overflow-hidden px-6 text-center">
      <div className="pointer-events-none absolute h-44 w-44 rounded-full bg-[color-mix(in_srgb,var(--AccentPrimary)_10%,transparent)] blur-3xl" />
      <div className="relative">
        <div className="absolute inset-0 scale-125 rounded-full bg-[color-mix(in_srgb,var(--AccentPrimary)_16%,transparent)] blur-xl" />
        <div className="relative z-10 flex h-14 w-14 items-center justify-center rounded-full border border-[color-mix(in_srgb,var(--AccentPrimary)_22%,var(--GlassBorder))] bg-[var(--GlassSurface-Elevated)] text-[var(--AccentPrimary)] shadow-[var(--shadow-surface)]">
          <Icons.Debug size={27} stroke={1.45} />
        </div>
      </div>
      <div className="relative z-10 space-y-2">
        <h3 className="text-[14px] font-semibold text-[var(--TextHighlight)]">
          {hasFile ? "当前文件无需调试" : "准备好开始调试"}
        </h3>
        <p className="text-[12px] leading-relaxed text-[var(--TextMuted)]">
          {hasFile ? (
            <>
              切换到受支持的代码文件
              <br />
              Aurona 会自动匹配可用调试配置
            </>
          ) : (
            <>
              打开一个代码文件
              <br />
              运行和调试工具会在这里自动就绪
            </>
          )}
        </p>
      </div>
      <div className="relative z-10 flex items-center gap-2 rounded-full border border-[color-mix(in_srgb,var(--AccentPrimary)_16%,var(--GlassBorder))] bg-[var(--GlassSurface-Base)] px-3 py-1 text-[11px] font-medium text-[var(--TextMuted)]">
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--AccentPrimary)] shadow-[0_0_7px_color-mix(in_srgb,var(--AccentPrimary)_65%,transparent)]" />
        等待代码上下文
      </div>
    </div>
  );
}

function debugConfigurationLabel(type: string, fallback: string): string {
  if (type === "python") return "Python";
  if (type === "node") return "Node.js";
  return fallback;
}

function fileName(path?: string): string {
  if (!path) return "未知来源";
  return path.split(/[\\/]/).pop() ?? path;
}
