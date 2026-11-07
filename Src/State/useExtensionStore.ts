import { useStore } from "zustand";
import { ExtensionRegistry, type ExtensionStoreState } from "../Core/Extensions/ExtensionRegistry";

export { VSCODE_COMPAT_EXTENSION_ID } from "../Core/Extensions/ExtensionRegistry";
export const useExtensionStore = Object.assign(
  <T = ExtensionStoreState>(
    selector: (state: ExtensionStoreState) => T = (state) => state as unknown as T,
  ) => useStore(ExtensionRegistry, selector),
  ExtensionRegistry,
);
