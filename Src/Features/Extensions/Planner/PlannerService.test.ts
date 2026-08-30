import { describe, expect, it } from "vitest";
import { migratePlannerDocument, toPlannerPayload } from "./PlannerService";

describe("PlannerService", () => {
  it("migrates the legacy task array to schema v2", () => {
    const document = migratePlannerDocument([
      {
        id: "legacy-1",
        title: 'Quoted "task"',
        category: "development",
        priority: "high",
        completed: true,
      },
    ]);

    expect(document.schemaVersion).toBe(2);
    expect(document.tasks[0]).toMatchObject({
      id: "legacy-1",
      status: "done",
      completed: true,
      priority: "high",
    });
  });

  it("normalizes v2 tasks and preserves tags and dates", () => {
    const document = migratePlannerDocument({
      schemaVersion: 2,
      tasks: [
        {
          id: "task-1",
          title: "Release",
          status: "blocked",
          priority: "normal",
          tags: ["release", 4],
          dueDate: "2026-08-25",
        },
      ],
    });

    expect(document.tasks[0]).toMatchObject({
      status: "blocked",
      tags: ["release"],
      dueDate: "2026-08-25",
      completed: false,
    });
  });

  it("serializes a v2 payload without the UI-only completed field", () => {
    const payload = JSON.parse(
      toPlannerPayload({
        schemaVersion: 2,
        tasks: [
          {
            id: "task-1",
            title: "Test",
            category: "general",
            description: "",
            status: "todo",
            priority: "normal",
            tags: [],
            order: 0,
            createdAt: "2026-08-22T00:00:00.000Z",
            updatedAt: "2026-08-22T00:00:00.000Z",
            completed: false,
          },
        ],
      }),
    ) as { schemaVersion: number; tasks: Array<Record<string, unknown>> };

    expect(payload.schemaVersion).toBe(2);
    expect(payload.tasks[0]?.completed).toBeUndefined();
    expect(payload.tasks[0]?.status).toBe("todo");
  });
});
