import { EditorAdapter } from "../../Core/Editor/EditorAdapter";
import { ExtensionIPC } from "../../Foundation/IPC/ExtensionCommands";

/**
 * 扩展编辑器桥：把后端扩展运行时的编辑器操控事件
 * （insert-text / reveal-line）转发给活动编辑器引擎。
 *
 * 权限（editor.current.write）已在后端 require 校验，前端只负责执行。
 */

let started = false;
let unlisteners: (() => void)[] = [];

export async function startExtensionEditorBridge(): Promise<() => void> {
  if (started) {
    return () => undefined;
  }
  started = true;

  const [insertUnlisten, revealUnlisten] = await Promise.all([
    ExtensionIPC.onEditorInsertText(({ text }) => {
      if (typeof text !== "string" || text.length === 0) return;
      EditorAdapter.insertCode(text, true);
    }),
    ExtensionIPC.onEditorRevealLine(({ line }) => {
      if (typeof line !== "number" || !Number.isFinite(line) || line < 1) return;
      EditorAdapter.revealLine(Math.trunc(line));
    }),
  ]);

  unlisteners = [insertUnlisten, revealUnlisten];
  return () => {
    unlisteners.forEach((unlisten) => {
      unlisten();
    });
    unlisteners = [];
    started = false;
  };
}
