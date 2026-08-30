import { desktopFileSystem } from "../../../Foundation/Desktop";

export type PlannerStatus = "todo" | "in_progress" | "done" | "blocked";
export type PlannerPriority = "low" | "normal" | "high";

export interface PlannerTask {
  id: string;
  title: string;
  category: string;
  description: string;
  status: PlannerStatus;
  priority: PlannerPriority;
  tags: string[];
  dueDate?: string;
  order: number;
  createdAt: string;
  updatedAt: string;
  completed: boolean;
}

export interface PlannerDocument {
  schemaVersion: 2;
  tasks: PlannerTask[];
}

const PATH = ".aurona/planner.json";

const now = () => new Date().toISOString();

function normalizeTask(raw: Record<string, unknown>, index: number): PlannerTask | null {
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  if (!title) return null;
  const status =
    raw.status === "done" || raw.status === "in_progress" || raw.status === "blocked"
      ? raw.status
      : raw.completed === true
        ? "done"
        : "todo";
  const priority = raw.priority === "high" || raw.priority === "low" ? raw.priority : "normal";
  const timestamp = typeof raw.updatedAt === "string" ? raw.updatedAt : now();
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : `task-${Date.now()}-${index}`,
    title,
    category: typeof raw.category === "string" && raw.category ? raw.category : "general",
    description: typeof raw.description === "string" ? raw.description : "",
    status,
    priority,
    tags: Array.isArray(raw.tags)
      ? raw.tags.filter((tag): tag is string => typeof tag === "string")
      : [],
    dueDate: typeof raw.dueDate === "string" ? raw.dueDate : undefined,
    order: typeof raw.order === "number" ? raw.order : index,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : timestamp,
    updatedAt: timestamp,
    completed: status === "done",
  };
}

export function migratePlannerDocument(raw: unknown): PlannerDocument {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const values = Array.isArray(raw) ? raw : Array.isArray(source.tasks) ? source.tasks : [];
  const tasks = values
    .filter((value): value is Record<string, unknown> =>
      Boolean(value && typeof value === "object"),
    )
    .map(normalizeTask)
    .filter((task): task is PlannerTask => task !== null)
    .sort((left, right) => left.order - right.order);
  return { schemaVersion: 2, tasks };
}

export function toPlannerPayload(document: PlannerDocument): string {
  return JSON.stringify({
    schemaVersion: 2,
    tasks: document.tasks.map(({ completed: _completed, ...task }) => ({
      ...task,
      updatedAt: task.updatedAt || now(),
    })),
  });
}

export const PlannerService = {
  async load(): Promise<{ document: PlannerDocument; migrated: boolean }> {
    if (!(await desktopFileSystem.exists(PATH)))
      return { document: { schemaVersion: 2, tasks: [] }, migrated: false };
    const raw = await desktopFileSystem.readTextFile(PATH);
    const parsed = JSON.parse(raw) as unknown;
    const migrated =
      Array.isArray(parsed) ||
      (parsed &&
        typeof parsed === "object" &&
        (parsed as Record<string, unknown>).schemaVersion !== 2);
    return { document: migratePlannerDocument(parsed), migrated: Boolean(migrated) };
  },

  async save(document: PlannerDocument): Promise<void> {
    await desktopFileSystem.mkdir(".aurona", { recursive: true });
    await desktopFileSystem.writeTextFile(PATH, `${toPlannerPayload(document)}\n`);
  },
};
