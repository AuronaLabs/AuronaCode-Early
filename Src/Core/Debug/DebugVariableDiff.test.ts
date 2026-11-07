import { describe, expect, it } from "vitest";
import { collectVariableValues, diffVariableValues } from "./DebugVariableDiff";

describe("DebugVariableDiff", () => {
  it("flattens scope variables into stable keys", () => {
    const values = collectVariableValues([{ name: "Locals", variablesReference: 1 }], {
      1: [
        { name: "x", value: "1", variablesReference: 0, evaluateName: "x" },
        { name: "y", value: "2", variablesReference: 0 },
      ],
    });
    expect(values).toEqual({ "Locals.x": "1", "Locals.y": "2" });
  });

  it("reports new and changed variables between pauses", () => {
    const changed = diffVariableValues(
      { "Locals.x": "1", "Locals.y": "2" },
      { "Locals.x": "1", "Locals.y": "3", "Locals.z": "4" },
    );
    expect(changed.sort()).toEqual(["Locals.y", "Locals.z"]);
  });
});
