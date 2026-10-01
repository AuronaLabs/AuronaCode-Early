import { describe, expect, it } from "vitest";
import { versionFamilyId } from "./ChangelogTab";

describe("Changelog version families", () => {
  it("groups patch and pioneer releases under the same minor line", () => {
    expect(versionFamilyId("V0.4.13")).toBe("0.4");
    expect(versionFamilyId("V0.4.0-pioneer.6")).toBe("0.4");
    expect(versionFamilyId("V0.3.16")).toBe("0.3");
  });
});
