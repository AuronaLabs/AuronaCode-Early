import { useEffect, useState } from "react";
import { desktopApp } from "../../Foundation/Desktop";
import { GlassContainer } from "../../UI/Core/GlassManager";
import { Icons } from "../../UI/Icons/IconManager";
import { InternalPageLayout } from "../../UI/Layouts/InternalPageLayout";

export function AboutTab() {
  const [osInfo, setOsInfo] = useState<string>("Detecting...");
  const [cpuCores, setCpuCores] = useState<number>(0);
  const [appVersion, setAppVersion] = useState<string>("Loading...");

  useEffect(() => {
    desktopApp
      .getVersion()
      .then((ver) => setAppVersion(ver))
      .catch(() => setAppVersion("0.2.0"));

    const ua = navigator.userAgent;
    let os = "Unknown OS";
    if (ua.indexOf("Win") !== -1) os = "Windows";
    if (ua.indexOf("Mac") !== -1) os = "macOS";
    if (ua.indexOf("Linux") !== -1) os = "Linux";

    if (os === "Windows") {
      const match = ua.match(/Windows NT ([\d.]+)/);
      if (match) os = `Windows NT ${match[1]}`;
    }
    setOsInfo(os);
    setCpuCores(navigator.hardwareConcurrency || 0);
  }, []);

  return (
    <InternalPageLayout maxWidth="max-w-4xl">
      <div className="flex flex-col items-center justify-center min-h-[70vh] gap-12 w-full select-none">
        {/* Logo and Version */}
        <div className="flex flex-col items-center gap-6 relative">
          <div className="absolute inset-0 bg-[var(--AccentPrimary)]/30 blur-[100px] rounded-full pointer-events-none" />
          <img
            src="/logo.png"
            alt="Aurona Code Logo"
            className="w-32 h-32 object-contain relative z-10 drop-shadow-2xl"
          />
          <div className="flex flex-col items-center gap-2 relative z-10">
            <h1
              className="text-[32px] font-bold text-[var(--TextHighlight)] tracking-wider"
              style={{ fontFamily: "'Righteous', sans-serif" }}
            >
              Aurona Code
            </h1>
            <div className="flex items-center gap-3">
              <span className="text-[14px] font-medium text-[var(--TextNormal)]">
                V{appVersion}
              </span>
              <span className="px-2 py-0.5 rounded-full bg-[var(--AccentPrimary)]/20 text-[var(--AccentPrimary)] text-[11px] font-bold tracking-widest border border-[var(--AccentPrimary)]/30">
                基于Corona+ 架构开发
              </span>
            </div>
            <p className="text-[13px] text-[var(--TextMuted)] mt-2 tracking-wide">
              基于 Tauri 构建的新一代轻量级、超高性能代码编辑器
            </p>
          </div>
        </div>

        {/* System Info Cards */}
        <div className="grid grid-cols-2 gap-4 w-full max-w-2xl mt-4">
          <GlassContainer
            layer="elevated"
            className="rounded-2xl p-5 flex flex-col gap-1.5 shadow-[0_12px_32px_rgba(15,23,42,0.08)]"
          >
            <div className="flex items-center gap-2 text-[var(--TextMuted)] mb-2">
              <Icons.Monitor size={16} />
              <span className="text-[12px] font-medium uppercase tracking-wider">系统架构</span>
            </div>
            <span className="text-[15px] font-medium text-[var(--TextHighlight)]">{osInfo}</span>
            <span className="text-[12px] text-[var(--TextMuted)]">x64 (Cores: {cpuCores})</span>
          </GlassContainer>

          <GlassContainer
            layer="elevated"
            className="rounded-2xl p-5 flex flex-col gap-1.5 shadow-[0_12px_32px_rgba(15,23,42,0.08)]"
          >
            <div className="flex items-center gap-2 text-[var(--TextMuted)] mb-2">
              <Icons.Sparkles size={16} />
              <span className="text-[12px] font-medium uppercase tracking-wider">技术栈</span>
            </div>
            <span className="text-[15px] font-medium text-[var(--TextHighlight)]">
              Tauri / WebView2
            </span>
            <span className="text-[12px] text-[var(--TextMuted)]">
              React 19 + Tailwind CSS + Radix UI
            </span>
          </GlassContainer>
        </div>

        {/* Copyright */}
        <div className="flex flex-col items-center gap-2 text-[12px] text-[var(--TextMuted)]/60 mt-8 text-center max-w-lg">
          <p>
            Aurona Code 的诞生离不开开源社区的伟大力量
            <br />
            特别感谢 Tauri 团队提供的高效跨平台能力，以及所有参与本项目的开源作者们
          </p>
          <p className="mt-2">Copyright © 2026 Aurona Labs. All rights reserved.</p>
        </div>
      </div>
    </InternalPageLayout>
  );
}
