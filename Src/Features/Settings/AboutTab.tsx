import { useEffect, useState } from "react";
import { desktopApp } from "../../Foundation/Desktop";
import { useLocale } from "../../Foundation/I18n";
import { PlatformService } from "../../Foundation/Platform";
import { GlassContainer } from "../../UI/Core/GlassManager";
import { Icons } from "../../UI/Icons/IconManager";
import { InternalPageLayout } from "../../UI/Layouts/InternalPageLayout";

export function AboutTab() {
  const { t } = useLocale();
  const [osInfo, setOsInfo] = useState<string>("Detecting...");
  const [cpuCores, setCpuCores] = useState<number>(0);
  const [appVersion, setAppVersion] = useState<string>("Loading...");
  const [architecture, setArchitecture] = useState<string>("unknown");
  const [webview, setWebview] = useState<string>("WebView");

  useEffect(() => {
    desktopApp
      .getVersion()
      .then((ver) => setAppVersion(ver))
      .catch(() => setAppVersion("0.2.0"));

    const platform = PlatformService.current();
    const info = PlatformService.info();
    setOsInfo(platform === "macos" ? "macOS" : platform === "linux" ? "Linux" : "Windows");
    setArchitecture(info.architecture);
    setWebview(
      platform === "macos" ? "WKWebView" : platform === "linux" ? "WebKitGTK" : "WebView2",
    );
    setCpuCores(navigator.hardwareConcurrency || 0);
  }, []);

  return (
    <InternalPageLayout maxWidth="max-w-4xl">
      <div className="flex flex-col items-center justify-center min-h-[70vh] gap-12 w-full select-none">
        {/* Logo and Version */}
        <div className="flex flex-col items-center gap-6 relative">
          <div className="absolute inset-0 bg-[var(--color-accent)]/30 blur-[100px] rounded-full pointer-events-none" />
          <img
            src="/logo.png"
            alt="Aurona Code Logo"
            className="w-32 h-32 object-contain relative z-10"
          />
          <div className="flex flex-col items-center gap-2 relative z-10">
            <h1
              className="text-[32px] font-bold text-[var(--color-text-highlight)] tracking-wider"
              style={{ fontFamily: "'Righteous', sans-serif" }}
            >
              Aurona Code
            </h1>
            <div className="flex items-center gap-3">
              <span className="text-[14px] font-medium text-[var(--color-text-primary)]">
                V{appVersion}
              </span>
              <span className="px-2 py-0.5 rounded-full bg-[var(--color-accent)]/20 text-[var(--color-accent)] text-[11px] font-bold tracking-widest border border-[var(--color-accent)]/30">
                {t("about.basedOn")}
              </span>
            </div>
            <p className="text-[13px] text-[var(--color-text-muted)] mt-2 tracking-wide">
              {t("about.tagline")}
            </p>
          </div>
        </div>

        {/* System Info Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-2xl mt-4">
          <GlassContainer layer="raised" className="flex flex-col gap-1.5 p-5">
            <div className="flex items-center gap-2 text-[var(--color-text-muted)] mb-2">
              <Icons.Monitor size={16} />
              <span className="text-[12px] font-medium uppercase tracking-wider">
                {t("about.systemArch")}
              </span>
            </div>
            <span className="text-[15px] font-medium text-[var(--color-text-highlight)]">
              {osInfo}
            </span>
            <span className="text-[12px] text-[var(--color-text-muted)]">
              {architecture} · {cpuCores} {t("about.cores")}
            </span>
          </GlassContainer>

          <GlassContainer layer="raised" className="flex flex-col gap-1.5 p-5">
            <div className="flex items-center gap-2 text-[var(--color-text-muted)] mb-2">
              <Icons.Sparkles size={16} />
              <span className="text-[12px] font-medium uppercase tracking-wider">
                {t("about.techStack")}
              </span>
            </div>
            <span className="text-[15px] font-medium text-[var(--color-text-highlight)]">
              Tauri / {webview}
            </span>
            <span className="text-[12px] text-[var(--color-text-muted)]">
              React 19 + Tailwind CSS + Radix UI
            </span>
          </GlassContainer>
        </div>

        {/* Copyright */}
        <div className="flex flex-col items-center gap-2 text-[12px] text-[var(--color-text-muted)]/60 mt-8 text-center max-w-lg">
          <p>
            {t("about.thanksTitle")}
            <br />
            {t("about.thanksBody")}
          </p>
          <p className="mt-2">Copyright © 2026 Aurona Labs. All rights reserved</p>
        </div>
      </div>
    </InternalPageLayout>
  );
}
