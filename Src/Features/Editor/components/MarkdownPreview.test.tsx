import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownPreview } from "./MarkdownPreview";

const mocks = vi.hoisted(() => ({ openFile: vi.fn() }));
vi.mock("../../../Foundation/I18n", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
vi.mock("../../../Core/FileSystemService", () => ({
  FileSystemService: {
    dirname: () => "C:/demo",
    joinPath: (parent: string, child: string) => `${parent}/${child}`,
  },
}));
vi.mock("../../../Foundation/IPC/FileSystemCommands", () => ({ FileSystemCommands: {} }));
vi.mock("../../../State/useWorkspaceStore", () => ({
  useWorkbenchStore: (selector: (state: { openFile: typeof mocks.openFile }) => unknown) =>
    selector({ openFile: mocks.openFile }),
}));

afterEach(cleanup);

function preview(content: string) {
  return (
    <MarkdownPreview
      content={content}
      path="C:/demo/readme.md"
      initialScrollTop={0}
      onScrollTopChange={() => undefined}
    />
  );
}

describe("Markdown preview navigation", () => {
  it("scrolls fragments within its own preview without navigating the app", () => {
    render(
      <>
        {preview("# 中文标题")}
        {preview("# 中文标题\n\n[Jump](#%E4%B8%AD%E6%96%87%E6%A0%87%E9%A2%98)")}
      </>,
    );
    const headings = screen.getAllByRole("heading", { name: "中文标题" });
    const firstScroll = vi.fn();
    const secondScroll = vi.fn();
    headings[0].scrollIntoView = firstScroll;
    headings[1].scrollIntoView = secondScroll;
    const before = window.location.href;
    expect(fireEvent.click(screen.getByRole("link", { name: "Jump" }))).toBe(false);
    expect(firstScroll).not.toHaveBeenCalled();
    expect(secondScroll).toHaveBeenCalledWith({ block: "start", behavior: "smooth" });
    expect(window.location.href).toBe(before);
    expect(mocks.openFile).not.toHaveBeenCalled();
  });

  it("ignores invalid and missing fragments without changing the address", () => {
    render(preview("[Invalid](#%broken)\n\n[Missing](#missing)"));
    const before = window.location.href;
    expect(fireEvent.click(screen.getByRole("link", { name: "Invalid" }))).toBe(false);
    expect(fireEvent.click(screen.getByRole("link", { name: "Missing" }))).toBe(false);
    expect(window.location.href).toBe(before);
  });

  it("keeps relative file links opening in the workbench", () => {
    const { container } = render(preview("[Read](notes%20today.md)"));
    fireEvent.click(container.querySelector("a") as HTMLAnchorElement);
    expect(mocks.openFile).toHaveBeenCalledWith("C:/demo/notes today.md");
  });
});
