/** Assemble extension capabilities with workbench presentation ports. */
import { createAuronaSDKHost as createHost } from "../../Core/Extensions/Host/AuronaSDKHost";
import { showSdkInputBox, showSdkQuickPick } from "../../Features/Extensions/SDK/SdkHostDialogs";
import { useWorkbenchStore } from "../../State/Workbench/useWorkbenchStore";
import { showToast } from "../../UI/Feedback/Toast";

export type { AuronaSDK } from "../../Core/Extensions/Host/AuronaSDKHost";
export { ExtensionFliunoRegistry } from "../../Core/Extensions/Host/AuronaSDKHost";

export function createAuronaSDKHost(extensionId: string) {
  return createHost(extensionId, {
    workbench: () => useWorkbenchStore.getState(),
    openFile: (path) => useWorkbenchStore.getState().openFile(path),
    showOutput: () => useWorkbenchStore.getState().setActiveBottomPanel("output"),
    notify: showToast,
    quickPick: showSdkQuickPick,
    inputBox: showSdkInputBox,
  });
}
