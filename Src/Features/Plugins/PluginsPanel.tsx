import React from "react";
import { Icons } from "../../UI/Icons/IconManager";

export const PluginsPanel = React.memo(function PluginsPanel() {
  return (
    <div className="flex flex-col h-full w-full select-none bg-transparent">
      <div className="flex items-center justify-between px-[var(--PanelPaddingX)] pt-4 pb-2 shrink-0">
        <h2 className="text-[14px] font-bold text-[var(--TextHighlight)] tracking-tight flex items-center gap-2">
          插件系统
          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/10 text-amber-500 uppercase tracking-wider">
            规划中
          </span>
        </h2>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center p-[var(--PanelPaddingX)] text-center gap-6 overflow-y-auto relative">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 bg-amber-500/5 blur-3xl rounded-full pointer-events-none" />

        <div className="relative">
          <div className="absolute inset-0 bg-amber-500/20 blur-xl rounded-full scale-125" />
          <div className="w-14 h-14 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500 relative z-10 animate-pulse">
            <Icons.Extensions size={28} stroke={1.5} />
          </div>
        </div>

        <div className="flex flex-col gap-2 relative z-10 max-w-[200px]">
          <h3 className="text-[14px] font-bold text-[var(--TextHighlight)]">插件功能尚未实现</h3>
          <p className="text-[12px] text-[var(--TextMuted)] leading-relaxed">
            当前版本没有插件运行功能
            <br />
            本页面仅作为页面保留
          </p>
        </div>

        <div className="flex items-center gap-2 text-[11px] text-amber-500 font-medium bg-amber-500/5 px-3 py-1 rounded-full border border-amber-500/10 relative z-10">
          <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
          <span>当前版本不提供插件功能</span>
        </div>
      </div>
    </div>
  );
});
