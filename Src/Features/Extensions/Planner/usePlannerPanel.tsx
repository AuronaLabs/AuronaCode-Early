import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WorkspaceService } from "../../../Core/WorkspaceService";
import { EventBus } from "../../../Foundation/EventBus";
import { Button } from "../../../UI/Components/Button";
import { Card } from "../../../UI/Components/Card";
import { Input } from "../../../UI/Components/Input";
import { Select } from "../../../UI/Components/Select";
import { Icons } from "../../../UI/Icons/IconManager";
import {
  type PlannerPriority,
  PlannerService,
  type PlannerStatus,
  type PlannerTask,
  toPlannerPayload,
} from "./PlannerService";

const CATEGORIES = [
  { name: "开发", color: "bg-[var(--StatusInfo)]" },
  { name: "测试", color: "bg-[var(--VizIndigo)]" },
  { name: "文档", color: "bg-[var(--StatusSuccess)]" },
  { name: "优化", color: "bg-[var(--StatusWarning)]" },
  { name: "设计", color: "bg-[var(--VizFuchsia)]" },
];

/** Planner alone owns task state, persistence and filtering; the extension host only composes its controls. */
export function usePlannerPanel(
  enabled: boolean,
  onRender: (document: { content: string; version: number }) => Promise<void>,
) {
  const [tasks, setTasks] = useState<PlannerTask[]>([]);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskCategory, setNewTaskCategory] = useState("开发");
  const [statusFilter, setStatusFilter] = useState<"all" | PlannerStatus>("all");
  const [priorityFilter, setPriorityFilter] = useState<"all" | PlannerPriority>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    if (!enabled) return;
    const load = async () => {
      const current = ++generation.current;
      await WorkspaceService.whenInitialized();
      if (generation.current !== current) return;
      try {
        const result = await PlannerService.load();
        if (generation.current !== current) return;
        if (result.migrated) await PlannerService.save(result.document);
        if (generation.current !== current) return;
        setTasks(result.document.tasks);
        setError(null);
      } catch (error) {
        if (generation.current === current) setError(String(error));
      }
    };
    void load();
    const unsubscribe = EventBus.on("workspace:root-changed", () => {
      void load();
    });
    return () => {
      ++generation.current;
      unsubscribe();
    };
  }, [enabled]);
  const persist = useCallback(
    async (next: PlannerTask[]) => {
      if (busy.current || !enabled) return false;
      busy.current = true;
      setSaving(true);
      const current = generation.current;
      try {
        await PlannerService.save({ schemaVersion: 2, tasks: next });
        if (current !== generation.current) return false;
        setTasks(next);
        setError(null);
        return true;
      } catch (error) {
        if (current === generation.current) setError(String(error));
        return false;
      } finally {
        busy.current = false;
        setSaving(false);
      }
    },
    [enabled],
  );
  const handleAddNewTask = async () => {
    const title = newTaskTitle.trim();
    if (!title) return;
    const now = new Date().toISOString();
    const next: PlannerTask = {
      id: crypto.randomUUID(),
      title,
      category: newTaskCategory,
      description: "",
      status: "todo",
      priority: "normal",
      tags: [],
      order: Date.now(),
      createdAt: now,
      updatedAt: now,
      completed: false,
    };
    if (await persist([next, ...tasks])) setNewTaskTitle("");
  };
  const filtered = useMemo(
    () =>
      tasks.filter(
        (task) =>
          (statusFilter === "all" || task.status === statusFilter) &&
          (priorityFilter === "all" || task.priority === priorityFilter) &&
          (!searchQuery.trim() ||
            [task.title, task.category, task.description, ...task.tags].some((value) =>
              value.toLowerCase().includes(searchQuery.trim().toLowerCase()),
            )),
      ),
    [tasks, statusFilter, priorityFilter, searchQuery],
  );
  useEffect(() => {
    if (enabled)
      void onRender({
        content: toPlannerPayload({ schemaVersion: 2, tasks: filtered }),
        version: Date.now(),
      });
  }, [enabled, filtered, onRender]);
  return {
    error,
    hasCompleted: tasks.some((task) => task.completed),
    clearCompleted: () => {
      void persist(tasks.filter((task) => !task.completed));
    },
    controls: (
      <div className="mx-[var(--PanelPaddingX)] mb-2 flex flex-col gap-2.5">
        {/* 快速新建任务卡片 */}
        <Card className="flex items-center gap-1.5 rounded-control p-1.5 transition-[border-color,box-shadow] focus-within:border-[var(--color-text-muted)]/25 focus-within:shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-text-muted)_14%,transparent)]">
          <input
            type="text"
            data-aurona-input="embedded"
            value={newTaskTitle}
            onChange={(e) => setNewTaskTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleAddNewTask();
            }}
            placeholder="新建任务或测试项..."
            className="min-w-0 flex-1 bg-transparent px-2.5 text-[12px] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-muted)]"
          />

          {/* 官方原生玻璃分类选择器 */}
          <div className="w-24 shrink-0">
            <Select
              value={newTaskCategory}
              onChange={(val) => setNewTaskCategory(val)}
              options={CATEGORIES.map((c) => ({
                label: c.name,
                value: c.name,
              }))}
              className="h-7 min-w-[90px] text-[11px] px-2 py-0"
            />
          </div>

          <Button
            size="sm"
            onClick={() => void handleAddNewTask()}
            disabled={saving || !newTaskTitle.trim()}
            className="h-7 shrink-0 px-2.5 text-[11px] rounded-control shadow-sm"
          >
            <Icons.Plus size={13} className="mr-0.5" />
            添加
          </Button>
        </Card>

        {/* 筛选与搜索 (两行现代排版) */}
        <div className="flex flex-col gap-2">
          {/* 第一行：状态切换分段按钮 (3 列平分) */}
          <div className="grid grid-cols-3 gap-1 p-0.5 rounded-surface border border-[var(--border-subtle)] bg-[var(--color-surface-2)]/80 shadow-2xs">
            <button
              type="button"
              onClick={() => setStatusFilter("all")}
              className={`py-1 text-[11.5px] font-medium rounded-control transition-all cursor-pointer text-center ${
                statusFilter === "all"
                  ? "bg-[var(--color-surface-3)] text-[var(--color-text-highlight)] shadow-xs font-semibold"
                  : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
              }`}
            >
              全部 ({tasks.length})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter("todo")}
              className={`py-1 text-[11.5px] font-medium rounded-control transition-all cursor-pointer text-center ${
                statusFilter === "todo"
                  ? "bg-[var(--color-surface-3)] text-[var(--color-text-highlight)] shadow-xs font-semibold"
                  : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
              }`}
            >
              待办 ({tasks.filter((t) => !t.completed).length})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter("done")}
              className={`py-1 text-[11.5px] font-medium rounded-control transition-all cursor-pointer text-center ${
                statusFilter === "done"
                  ? "bg-[var(--color-surface-3)] text-[var(--color-text-highlight)] shadow-xs font-semibold"
                  : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
              }`}
            >
              已完成 ({tasks.filter((t) => t.completed).length})
            </button>
          </div>

          {/* 第二行：优先级选择器 + 搜索框 */}
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <Select
                value={priorityFilter}
                onChange={(value) => setPriorityFilter(value as "all" | PlannerPriority)}
                options={[
                  { label: "全部优先级", value: "all" },
                  { label: "高优先级", value: "high" },
                  { label: "普通优先级", value: "normal" },
                  { label: "低优先级", value: "low" },
                ]}
                className="h-[28px] w-full min-w-0 text-[11.5px] px-2.5 py-0.5 rounded-control border-[var(--border-subtle)] bg-[var(--material-surface)]"
              />
            </div>
            <div className="flex-1 min-w-0">
              <Input
                icon={<Icons.Search size={14} />}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索任务..."
                inputSize="sm"
                surface="glass"
                fullWidth
              />
            </div>
          </div>
        </div>
      </div>
    ),
  };
}
