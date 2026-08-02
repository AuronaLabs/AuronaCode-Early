import { invokeDesktop } from "../Desktop";

export interface WorkspaceFileEntry {
  path: string;
  relativePath: string;
  name: string;
}

export interface WorkspaceTextSearchResult {
  file_path: string;
  line_number: number;
  match_text: string;
  index: number;
}

export interface WorkspaceTextSearchResponse {
  results: WorkspaceTextSearchResult[];
  limit_reached: boolean;
}

export const WorkspaceSearchIPC = {
  listFiles(path: string): Promise<WorkspaceFileEntry[]> {
    return invokeDesktop("list_workspace_files", { path });
  },

  searchText(
    path: string,
    query: string,
    isCaseSensitive: boolean,
    isRegex: boolean,
    requestId: string,
  ): Promise<WorkspaceTextSearchResponse> {
    return invokeDesktop("search_workspace", {
      path,
      query,
      isCaseSensitive,
      isRegex,
      requestId,
    });
  },

  cancel(requestId: string): Promise<boolean> {
    return invokeDesktop("cancel_search", { requestId });
  },
};
