import { type ReactNode, useEffect, useState } from "react";
import { DebugConfigurationService } from "../../Core/DebugConfigurationService";
import { DebugService } from "../../Core/DebugService";
import { LocaleService, useLocale } from "../../Foundation/I18n";
import { type DebugBreakpoint, type DebugVariable, useDebugStore } from "../../State/useDebugStore";
import { useWorkbenchStore } from "../../State/useWorkspaceStore";
import { Button } from "../../UI/Components/Button";
import { EmptyState } from "../../UI/Components/EmptyState";
import {
  GlassList,
  glassListHeaderStyles,
  glassListRowStyles,
} from "../../UI/Components/GlassList";
import { Input } from "../../UI/Components/Input";
import { Modal } from "../../UI/Components/Modal";
import { Select } from "../../UI/Components/Select";
import { Tooltip } from "../../UI/Feedback/Tooltip";
import { Icons } from "../../UI/Icons/IconManager";
import { SidebarPageHeader } from "../../UI/Layouts/SidebarPage";
import { VariableScope } from "./components/VariableScope";

export function DebugPanel() {
  const { t } = useLocale();
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
  const [editingBreakpoint, setEditingBreakpoint] = useState<DebugBreakpoint | null>(null);
  const [breakpointDraft, setBreakpointDraft] = useState({
    condition: "",
    hitCondition: "",
    logMessage: "",
  });

  const start = () => {
    if (selected) void DebugService.start(selected, activeFile);
  };

  const saveBreakpoint = () => {
    if (!editingBreakpoint) return;
    debug.set({
      breakpoints: debug.breakpoints.map((item) =>
        item.path === editingBreakpoint.path && item.line === editingBreakpoint.line
          ? {
              ...item,
              condition: breakpointDraft.condition.trim() || undefined,
              hitCondition: breakpointDraft.hitCondition.trim() || undefined,
              logMessage: breakpointDraft.logMessage.trim() || undefined,
            }
          : item,
      ),
    });
    setEditingBreakpoint(null);
    void DebugService.syncBreakpoints();
  };

  return (
    <section className="flex h-full min-h-0 flex-col">
      <SidebarPageHeader
        title={t("debug.sidebarTitle")}
        actions={
          <>
            {debug.configurations.length > 0 && (
              <HeaderAction
                label={t("debug.editConfig")}
                icon={<Icons.FileCode size={16} />}
                onClick={() => {
                  const path = DebugConfigurationService.getConfigurationPath();
                  if (path) useWorkbenchStore.getState().openFile(path);
                }}
              />
            )}
            <HeaderAction
              label={t("debug.refreshConfig")}
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
                  ariaLabel={t("debug.configLabel")}
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
                <div className="flex h-8 min-w-0 flex-1 items-center px-1 text-[11px] text-[var(--color-text-muted)]">
                  {t("debug.noDebuggableProject")}
                </div>
              )}
              <Button
                size="icon"
                variant={running ? "danger" : "primary"}
                aria-label={running ? t("debug.stopDebug") : t("debug.startDebug")}
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
            <SessionStatus state={debug.state} configuration={selected?.name} />
          </div>

          {(debug.state === "running" || debug.state === "paused") && (
            <DebugToolbar
              paused={debug.state === "paused"}
              onRestart={() => {
                if (selected) void DebugService.restart(selected, activeFile);
              }}
            />
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
              <div className="mx-[var(--PanelPaddingX)] mb-2 rounded-xl bg-[var(--StatusError)]/10 px-3 py-2.5 text-[11px] leading-5 text-[var(--StatusError)]">
                {debug.error}
              </div>
            )}
            {!debug.configurations.length && !debug.error && (
              <EmptyState
                icon={<Icons.Debug size={27} stroke={1.45} />}
                title={t("debug.openDebuggableFile")}
                description={t("debug.openDebuggableFileDesc")}
              />
            )}

            <GlassList className="mx-[var(--PanelPaddingX)] mt-2">
              <DebugSection
                title={t("debug.threads")}
                icon={<Icons.Debug size={14} />}
                count={debug.threads.length}
                empty={t("debug.threadsEmpty")}
              >
                {debug.threads.map((thread) => (
                  <button
                    type="button"
                    key={thread.id}
                    className={`${glassListRowStyles} w-full text-left ${
                      thread.id === debug.selectedThreadId ? "bg-[var(--material-panel)]" : ""
                    }`}
                    onClick={() => void DebugService.selectThread(thread.id)}
                  >
                    <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--color-text-primary)]">
                      {thread.name}
                    </span>
                    <span className="font-mono text-[9px] text-[var(--color-text-muted)]">
                      #{thread.id}
                    </span>
                  </button>
                ))}
              </DebugSection>

              <WatchSection />

              <DebugSection
                title={t("debug.stackTitle")}
                icon={<Icons.Stack size={14} />}
                count={debug.stackFrames.length}
                empty={t("debug.stackEmpty")}
              >
                {debug.stackFrames.map((frame) => (
                  <button
                    type="button"
                    key={frame.id}
                    className={`${glassListRowStyles} w-full min-w-0 flex-col items-start text-left ${
                      frame.id === debug.selectedFrameId ? "bg-[var(--material-panel)]" : ""
                    }`}
                    onClick={() => {
                      void DebugService.selectFrame(frame.id);
                      if (!frame.source?.path) return;
                      useWorkbenchStore.getState().openFile(frame.source.path);
                      useWorkbenchStore.getState().requestReveal(frame.source.path, frame.line);
                    }}
                  >
                    {frame.id === debug.selectedFrameId && (
                      <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-[var(--color-accent)]" />
                    )}
                    <span className="truncate text-[12px] font-medium text-[var(--color-text-primary)]">
                      {frame.name}
                    </span>
                    <span className="mt-0.5 truncate text-[10px] text-[var(--color-text-muted)]">
                      {fileName(frame.source?.path)} · {frame.line}:{frame.column}
                    </span>
                  </button>
                ))}
              </DebugSection>

              <DebugSection
                title={t("debug.variablesTitle")}
                icon={<Icons.Variables size={14} />}
                count={debug.scopes.reduce(
                  (count, scope) =>
                    count + (debug.variablesByReference[scope.variablesReference]?.length ?? 0),
                  0,
                )}
                empty={t("debug.variablesEmpty")}
              >
                {debug.scopes.map((scope) => (
                  <VariableScope
                    key={scope.variablesReference}
                    name={scope.name}
                    variables={debug.variablesByReference[scope.variablesReference] ?? []}
                    variablesByReference={debug.variablesByReference}
                    loadingReferences={debug.loadingVariableReferences}
                    changedVariables={debug.changedVariables}
                    variablePagination={debug.variablePagination}
                  />
                ))}
              </DebugSection>

              <DebugSection
                title={t("debug.breakpoints")}
                icon={<Icons.Breakpoint size={14} />}
                count={debug.breakpoints.length}
                empty={t("debug.breakpointsEmpty")}
              >
                {debug.breakpoints.length > 0 && (
                  <div className="flex items-center gap-1 px-1 pb-1">
                    <button
                      type="button"
                      className="rounded-md px-1.5 py-1 text-[9px] text-[var(--color-text-muted)] hover:bg-[var(--material-interactive-hover)] hover:text-[var(--color-text-highlight)]"
                      onClick={() => void DebugService.setAllBreakpointsEnabled(true)}
                    >
                      {t("debug.enableAll")}
                    </button>
                    <button
                      type="button"
                      className="rounded-md px-1.5 py-1 text-[9px] text-[var(--color-text-muted)] hover:bg-[var(--material-interactive-hover)] hover:text-[var(--color-text-highlight)]"
                      onClick={() => void DebugService.setAllBreakpointsEnabled(false)}
                    >
                      {t("debug.disableAll")}
                    </button>
                    <button
                      type="button"
                      className="ml-auto rounded-md px-1.5 py-1 text-[9px] text-[var(--StatusError)]/80 hover:bg-[var(--StatusError)]/10 hover:text-[var(--StatusError)]"
                      onClick={() => void DebugService.removeAllBreakpoints()}
                    >
                      {t("debug.removeAll")}
                    </button>
                  </div>
                )}
                {debug.breakpoints.map((breakpoint) => (
                  <div
                    key={`${breakpoint.path}:${breakpoint.line}`}
                    className={`${glassListRowStyles} min-w-0 gap-2 ${
                      breakpoint.enabled === false ? "opacity-45" : ""
                    }`}
                  >
                    <button
                      type="button"
                      aria-label={`${breakpoint.enabled === false ? t("debug.enableAll") : t("debug.disableAll")} ${fileName(breakpoint.path)} ${breakpoint.line}`}
                      onClick={() => {
                        debug.setBreakpointEnabled(
                          breakpoint.path,
                          breakpoint.line,
                          breakpoint.enabled === false,
                        );
                        void DebugService.syncBreakpoints();
                      }}
                      className="shrink-0"
                    >
                      <span
                        className={`block h-2.5 w-2.5 rounded-full ${
                          breakpoint.enabled === false
                            ? "border border-[var(--DiagError)] opacity-40"
                            : breakpoint.verified === false
                              ? "border border-[var(--DiagError)]"
                              : "bg-[var(--DiagError)] shadow-[0_0_0_2px_color-mix(in_srgb,var(--DiagError)_12%,transparent)]"
                        }`}
                      />
                    </button>
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
                      <div className="truncate text-[11px] font-medium text-[var(--color-text-primary)]">
                        {fileName(breakpoint.path)}
                      </div>
                      <div className="truncate text-[9px] text-[var(--color-text-muted)]">
                        第 {breakpoint.line} 行 ·{" "}
                        {breakpoint.enabled === false
                          ? t("debug.disabled")
                          : breakpoint.verified
                            ? t("debug.verified")
                            : t("debug.unverified")}
                        {breakpoint.message ? ` · ${breakpoint.message}` : ""}
                        {breakpoint.condition ? ` · if ${breakpoint.condition}` : ""}
                        {breakpoint.hitCondition ? ` · hit ${breakpoint.hitCondition}` : ""}
                        {breakpoint.logMessage ? " · log" : ""}
                      </div>
                    </button>
                    <button
                      type="button"
                      aria-label={t("debug.editBreakpoint")}
                      className="rounded-md p-1 text-[9px] text-[var(--color-text-muted)] opacity-0 transition-opacity hover:text-[var(--color-text-highlight)] group-hover:opacity-100 focus-visible:opacity-100"
                      onClick={() => {
                        setBreakpointDraft({
                          condition: breakpoint.condition ?? "",
                          hitCondition: breakpoint.hitCondition ?? "",
                          logMessage: breakpoint.logMessage ?? "",
                        });
                        setEditingBreakpoint(breakpoint);
                      }}
                    >
                      {t("debug.editBreakpoint")}
                    </button>
                    <button
                      type="button"
                      aria-label={`移除 ${fileName(breakpoint.path)} 第 ${breakpoint.line} 行断点`}
                      className="rounded-md p-1 text-[var(--color-text-muted)] opacity-0 transition-opacity hover:text-[var(--StatusError)] group-hover:opacity-100 focus-visible:opacity-100"
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
      <Modal
        isOpen={editingBreakpoint !== null}
        onClose={() => setEditingBreakpoint(null)}
        title={t("debug.editBreakpoint")}
        icon={<Icons.Breakpoint size={18} />}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditingBreakpoint(null)}>
              {t("language.cancel")}
            </Button>
            <Button variant="primary" onClick={saveBreakpoint}>
              {t("debug.save")}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="block space-y-1">
            <span className="text-[11px] font-medium text-[var(--color-text-primary)]">
              {t("debug.condition")}
            </span>
            <Input
              fullWidth
              inputSize="md"
              className="font-mono"
              value={breakpointDraft.condition}
              onChange={(event) =>
                setBreakpointDraft((draft) => ({ ...draft, condition: event.target.value }))
              }
              placeholder={t("debug.conditionPlaceholder")}
            />
          </div>
          <div className="block space-y-1">
            <span className="text-[11px] font-medium text-[var(--color-text-primary)]">
              {t("debug.hitCondition")}
            </span>
            <Input
              fullWidth
              inputSize="md"
              className="font-mono"
              value={breakpointDraft.hitCondition}
              onChange={(event) =>
                setBreakpointDraft((draft) => ({ ...draft, hitCondition: event.target.value }))
              }
              placeholder={t("debug.hitConditionPlaceholder")}
            />
          </div>
          <div className="block space-y-1">
            <span className="text-[11px] font-medium text-[var(--color-text-primary)]">
              {t("debug.logMessage")}
            </span>
            <Input
              fullWidth
              inputSize="md"
              className="font-mono"
              value={breakpointDraft.logMessage}
              onChange={(event) =>
                setBreakpointDraft((draft) => ({ ...draft, logMessage: event.target.value }))
              }
              placeholder={t("debug.logMessagePlaceholder")}
            />
          </div>
        </div>
      </Modal>
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
        className="rounded-lg p-1.5 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--material-interactive-hover)] hover:text-[var(--color-text-highlight)]"
        onClick={onClick}
      >
        {icon}
      </button>
    </Tooltip>
  );
}

function SessionStatus({
  state,
  configuration,
}: {
  state: ReturnType<typeof useDebugStore.getState>["state"];
  configuration?: string;
}) {
  const { t } = useLocale();
  const stateLabels = {
    idle: t("debug.sessionIdle"),
    starting: t("debug.sessionStarting"),
    running: t("debug.sessionRunning"),
    paused: t("debug.sessionPaused"),
    stopping: t("debug.sessionStopping"),
    failed: t("debug.sessionFailed"),
  };
  return (
    <div className="mt-2 flex items-center gap-1.5 px-1 text-[10px] text-[var(--color-text-muted)]">
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          state === "running"
            ? "bg-[var(--StatusSuccess)]"
            : state === "paused"
              ? "bg-[var(--StatusWarning)]"
              : state === "failed"
                ? "bg-[var(--StatusError)]"
                : "bg-[var(--color-text-muted)]/50"
        }`}
      />
      {stateLabels[state]}
      {configuration && (
        <span className="ml-auto max-w-[160px] truncate rounded-md bg-[var(--material-interactive-hover)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--color-text-primary)]">
          {configuration}
        </span>
      )}
    </div>
  );
}

function DebugToolbar({ paused, onRestart }: { paused: boolean; onRestart: () => void }) {
  const { t } = useLocale();
  const actions = paused
    ? [
        {
          command: "continue" as const,
          label: t("debug.continue"),
          icon: <Icons.Play size={15} />,
        },
        {
          command: "next" as const,
          label: t("debug.stepOver"),
          icon: <Icons.StepOver size={15} />,
        },
        { command: "stepIn" as const, label: t("debug.stepIn"), icon: <Icons.StepIn size={15} /> },
        {
          command: "stepOut" as const,
          label: t("debug.stepOut"),
          icon: <Icons.StepOut size={15} />,
        },
      ]
    : [{ command: "pause" as const, label: t("debug.pause"), icon: <Icons.Pause size={15} /> }];
  return (
    <div className="flex shrink-0 items-center gap-0.5 border-y border-[var(--border-subtle)] px-[var(--PanelPaddingX)] py-1.5">
      {actions.map((action) => (
        <Tooltip key={action.command} content={action.label} placement="bottom">
          <button
            type="button"
            aria-label={action.label}
            onClick={() => void DebugService.request(action.command)}
            className="rounded-lg p-1.5 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--material-interactive-hover)] hover:text-[var(--color-text-highlight)]"
          >
            {action.icon}
          </button>
        </Tooltip>
      ))}
      <span className="mx-1 h-4 w-px bg-[var(--border-subtle)]" />
      <Tooltip content={t("debug.restartSession")} placement="bottom">
        <button
          type="button"
          aria-label={t("debug.restartSession")}
          onClick={onRestart}
          className="rounded-lg p-1.5 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--material-interactive-hover)] hover:text-[var(--color-text-highlight)]"
        >
          <Icons.Refresh size={15} />
        </button>
      </Tooltip>
      <Tooltip content={t("debug.stopDebug")} placement="bottom">
        <button
          type="button"
          aria-label={t("debug.stopDebug")}
          onClick={() => void DebugService.stop()}
          className="rounded-lg p-1.5 text-[var(--StatusError)] transition-colors hover:bg-[var(--StatusError)]/10"
        >
          <Icons.Stop size={15} />
        </button>
      </Tooltip>
    </div>
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
  const { t } = useLocale();
  return (
    <div className="mx-[var(--PanelPaddingX)] mb-3 rounded-xl border border-[var(--StatusWarning)]/20 bg-[var(--StatusWarning)]/10 p-3">
      <div className="flex items-start gap-2.5">
        <Icons.Download className="mt-0.5 shrink-0 text-[var(--StatusWarning)]" size={15} />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold text-[var(--color-text-primary)]">
            {t("debug.needsPythonComponent")}
          </div>
          <p className="mt-1 break-words text-[10px] leading-4 text-[var(--color-text-muted)]">
            {message}
          </p>
          <Button className="mt-2" size="sm" disabled={busy} onClick={onInstall}>
            {busy ? t("debug.installing") : t("debug.installAndContinue")}
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
    <section className="border-b border-[var(--border-subtle)] last:border-b-0">
      <button
        type="button"
        className={`${glassListHeaderStyles} w-full gap-2 text-left font-semibold`}
        onClick={() => setExpanded((value) => !value)}
      >
        <Icons.ChevronRight
          size={12}
          className={`transition-transform ${expanded ? "rotate-90" : ""}`}
        />
        <span className="text-[var(--color-text-muted)]">{icon}</span>
        <span>{title}</span>
        <span className="ml-auto min-w-5 rounded-full bg-[var(--material-surface)] px-1.5 py-0.5 text-center text-[9px] font-normal text-[var(--color-text-muted)]">
          {count}
        </span>
      </button>
      {expanded &&
        (count > 0 ? (
          <div className="space-y-0.5 p-1.5">{children}</div>
        ) : (
          <div className="px-4 py-3 text-[10px] leading-4 text-[var(--color-text-muted)]">
            {empty}
          </div>
        ))}
    </section>
  );
}

function WatchSection() {
  const { t } = useLocale();
  const watchExpressions = useDebugStore((state) => state.watchExpressions);
  const [draft, setDraft] = useState("");

  const add = () => {
    const expression = draft.trim();
    if (!expression) return;
    void DebugService.addWatch(expression);
    setDraft("");
  };

  return (
    <DebugSection
      title={t("debug.watches")}
      icon={<Icons.Variables size={14} />}
      count={watchExpressions.length}
      empty={t("debug.watchEmpty")}
    >
      <div className="flex items-center gap-1 px-1 pb-1.5">
        <Input
          inputSize="sm"
          className="min-w-0 flex-1"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") add();
          }}
          placeholder={t("debug.addWatch")}
        />
        <button
          type="button"
          disabled={!draft.trim()}
          onClick={add}
          className="rounded-md px-1.5 py-1 text-[9px] text-[var(--color-text-muted)] transition-colors hover:bg-[var(--material-interactive-hover)] hover:text-[var(--color-text-highlight)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t("debug.addWatch")}
        </button>
      </div>
      {watchExpressions.map((entry) => (
        <div key={entry.id} className={`${glassListRowStyles} min-w-0 gap-2`}>
          <button
            type="button"
            className="min-w-0 flex-1 text-left"
            onClick={() => void DebugService.updateWatchExpression(entry.id, entry.expression)}
          >
            <div className="truncate font-mono text-[10px] font-medium text-[var(--color-text-primary)]">
              {entry.expression}
            </div>
            {entry.error ? (
              <div className="truncate text-[9px] text-[var(--StatusError)]">{entry.error}</div>
            ) : (
              entry.value !== undefined && (
                <div className="truncate text-[9px] text-[var(--color-text-muted)]">
                  {entry.value}
                </div>
              )
            )}
          </button>
          <button
            type="button"
            aria-label={`${t("debug.removeWatch")} ${entry.expression}`}
            className="rounded-md p-1 text-[var(--color-text-muted)] opacity-0 transition-opacity hover:text-[var(--StatusError)] group-hover:opacity-100 focus-visible:opacity-100"
            onClick={() => DebugService.removeWatch(entry.id)}
          >
            <Icons.Close size={11} />
          </button>
        </div>
      ))}
    </DebugSection>
  );
}

function DebugContextEmpty({ hasFile }: { hasFile: boolean }) {
  const { t } = useLocale();
  return (
    <EmptyState
      className="min-h-0 flex-1"
      icon={<Icons.Debug size={27} stroke={1.45} />}
      title={hasFile ? t("debug.currentFileNoDebug") : t("debug.readyToDebug")}
      description={
        hasFile ? (
          <>
            {t("debug.switchToSupportedFile")}
            <br />
            {t("debug.autoMatchConfig")}
          </>
        ) : (
          <>
            {t("debug.openFileToDebug")}
            <br />
            {t("debug.toolsReadyHint")}
          </>
        )
      }
      badge={t("debug.waitingContext")}
    />
  );
}

function debugConfigurationLabel(type: string, fallback: string): string {
  if (type === "python") return "Python";
  if (type === "node") return "Node.js";
  return fallback;
}

function fileName(path?: string): string {
  if (!path) return LocaleService.translate("debug.unknownSource");
  return path.split(/[\\/]/).pop() ?? path;
}
