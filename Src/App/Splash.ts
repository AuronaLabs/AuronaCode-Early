import "./Styles/Splash.css";
import { desktopApp } from "../Foundation/Desktop";
import { AppLifecycleIPC } from "../Foundation/IPC/AppLifecycleCommands";

document.addEventListener("contextmenu", (event) => event.preventDefault());

// The splash window is visible from the native window configuration. Mark the
// first frame so Rust can keep the brand artwork visible for a real two
// seconds without delaying window creation or image decoding.
requestAnimationFrame(() => {
  AppLifecycleIPC.markSplashscreenShown().catch(console.error);
});

desktopApp
  .getVersion()
  .then((version) => {
    const element = document.getElementById("SplashVersion");
    if (element) element.textContent = `v${version}`;
  })
  .catch(console.error);
