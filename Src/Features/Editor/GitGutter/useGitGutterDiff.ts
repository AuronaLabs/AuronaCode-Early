import { useEffect, useState } from "react";
import { EventBus } from "../../../Foundation/EventBus";

export interface GitGutterDiffState {
  addedLines: Set<number>;
  modifiedLines: Set<number>;
  deletedLines: Set<number>;
}

export function useGitGutterDiff(path?: string): GitGutterDiffState {
  const [diffState, setDiffState] = useState<GitGutterDiffState>({
    addedLines: new Set(),
    modifiedLines: new Set(),
    deletedLines: new Set(),
  });

  useEffect(() => {
    if (!path) {
      setDiffState({
        addedLines: new Set(),
        modifiedLines: new Set(),
        deletedLines: new Set(),
      });
      return;
    }

    const handleGitUpdate = () => {
      // 订阅 Git 变动事件，根据当前文件状态标记行变动
    };

    const unsub = EventBus.on("git:changes-count", handleGitUpdate);
    return () => unsub();
  }, [path]);

  return diffState;
}
