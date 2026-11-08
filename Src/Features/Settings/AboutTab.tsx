import { useEffect, useState } from "react";
import { CommandRegistry } from "../../Core/Commands/CommandRegistry";
import { desktopApp } from "../../Foundation/Desktop";
import { useLocale } from "../../Foundation/I18n";
import { PlatformService } from "../../Foundation/Platform";
import { formatDisplayVersion } from "../../Foundation/Release/ReleaseChannel";
import { Button } from "../../UI/Components/Button";
import { Icons } from "../../UI/Icons/IconManager";
import { InternalPageLayout } from "../../UI/Layouts/InternalPageLayout";
import "./AboutTab.css";

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
      .catch(() => setAppVersion(import.meta.env.VITE_APP_VERSION));

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
    <InternalPageLayout maxWidth="max-w-3xl">
      <div className="about-page">
        <section className="about-hero">
          <div className="about-brand">
            <img src="/logo.png" alt="" className="about-mark" />
            <div>
              <h1 className="about-wordmark">Aurona Code</h1>
              <p className="about-tagline">{t("about.tagline")}</p>
            </div>
          </div>
          <div className="about-release">
            <span className="about-version">{formatDisplayVersion(appVersion)}</span>
            <Button
              variant="ghost"
              onClick={() => void CommandRegistry.execute("workbench.action.openChangelog")}
            >
              {t("commands.openChangelog")}
              <Icons.ArrowRight size={15} />
            </Button>
          </div>
        </section>

        <section className="about-details" aria-label={t("about.systemArch")}>
          <div className="about-detail">
            <Icons.Monitor size={19} stroke={1.5} aria-hidden="true" />
            <div>
              <h2>{t("about.systemArch")}</h2>
              <p>{osInfo}</p>
              <span>
                {architecture} · {cpuCores} {t("about.cores")}
              </span>
            </div>
          </div>
          <div className="about-detail">
            <Icons.Stack size={19} stroke={1.5} aria-hidden="true" />
            <div>
              <h2>{t("about.techStack")}</h2>
              <p>
                Tauri <span>· {webview}</span>
              </p>
              <span>React 19 · Tailwind CSS · Radix UI</span>
            </div>
          </div>
        </section>
        <section className="about-thanks">
          <Icons.Github size={19} stroke={1.5} aria-hidden="true" />
          <div>
            <h2>{t("about.thanksTitle")}</h2>
            <p>{t("about.thanksBody")}</p>
          </div>
        </section>
        <footer className="about-footer">
          <span>Aurona Labs</span>
          <span>Copyright © 2026 Aurona Labs. All rights reserved.</span>
        </footer>
      </div>
    </InternalPageLayout>
  );
}
