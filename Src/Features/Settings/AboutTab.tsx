import { useState, useEffect } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { InternalPageLayout } from '../../UI/Layouts/InternalPageLayout';

export function AboutTab() {
  const [osInfo, setOsInfo] = useState<string>("Detecting...");
  const [cpuCores, setCpuCores] = useState<number>(0);
  const [appVersion, setAppVersion] = useState<string>("Loading...");

  useEffect(() => {
    // Fetch version natively from Tauri
    getVersion().then(ver => setAppVersion(ver)).catch(() => setAppVersion("0.0.3"));

    // Basic User-Agent string parsing for real OS data in frontend
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
    <InternalPageLayout title="关于 Aurona Code">
      <div className="flex flex-col gap-8 max-w-xl">
        {/* Version Info */}
        <div className="flex flex-col gap-1.5">
          <span className="text-[15px] font-semibold text-[var(--ColorTextHighlight)]">Aurona Code - V{appVersion}</span>
          <span className="text-[13px] text-[var(--ColorMuted)]">
            基于 Tauri 构建的新一代轻量级桌面代码编辑器
          </span>
        </div>

        {/* System Environment */}
        <div className="flex flex-col gap-6 pt-6">
          <h3 className="text-[14px] font-semibold text-[var(--ColorTextHighlight)]">
            系统与环境信息
          </h3>
          <div className="grid grid-cols-2 gap-y-8 gap-x-12 text-[13px]">
            <div className="flex flex-col gap-2">
              <span className="text-[var(--ColorMuted)]">操作系统</span>
              <span className="font-medium text-[var(--ColorTextHighlight)] text-[15px]">{osInfo}</span>
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-[var(--ColorMuted)]">硬件架构</span>
              <span className="font-medium text-[var(--ColorTextHighlight)] text-[15px]">x64 (CPU Cores: {cpuCores})</span>
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-[var(--ColorMuted)]">渲染引擎</span>
              <span className="font-medium text-[var(--ColorTextHighlight)] text-[15px]">Tauri / WebView2</span>
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-[var(--ColorMuted)]">UI 框架</span>
              <span className="font-medium text-[var(--ColorTextHighlight)] text-[15px]">React 19 + Tailwind v4</span>
            </div>
          </div>
        </div>
        
        <div className="flex flex-col gap-6 pt-6">
          <h3 className="text-[14px] font-semibold text-[var(--ColorTextHighlight)]">
            致谢与开源许可
          </h3>
          <p className="text-[13px] text-[var(--ColorMuted)] leading-relaxed max-w-xl">
            Aurona Code 的诞生离不开开源社区的伟大力量。特别感谢 <span className="text-[var(--ColorTextHighlight)] font-medium">Tauri</span> 提供的高效跨平台能力，以及所有参与本项目的开源作者们。
          </p>
        </div>
      </div>
    </InternalPageLayout>
  );
}
