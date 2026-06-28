import type { FileNode } from "../../../Core/FileSystemService";

// 递归更新树中指定路径的节点
export const updateTree = (
  nodes: FileNode[],
  targetPath: string,
  updater: (node: FileNode) => FileNode
): FileNode[] =>
  nodes.map((node) => {
    if (node.path === targetPath) return updater(node);
    if (node.children && isDescendant(targetPath, node.path)) {
      return { ...node, children: updateTree(node.children, targetPath, updater) };
    }
    return node;
  });

// 判断 path 是否是 possibleParent 的子路径
export const isDescendant = (path: string, possibleParent: string): boolean =>
  path.startsWith(`${possibleParent}/`) || path.startsWith(`${possibleParent}\\`);

// 收集已展开目录的路径集合
export const collectOpenPaths = (
  nodes: FileNode[] = [],
  result = new Set<string>()
): Set<string> => {
  for (const node of nodes) {
    if (node.isDirectory && node.isOpen) result.add(node.path);
    if (node.children) collectOpenPaths(node.children, result);
  }
  return result;
};

// 刷新后将旧展开状态合并到新节点树，同时保留原有的 children 数据
export const mergeOpenState = (
  nodes: FileNode[],
  oldNodes: FileNode[],
  openPaths: Set<string>
): FileNode[] => {
  const oldNodeMap = new Map(oldNodes.map(n => [n.path, n]));
  return nodes.map((node) => {
    const oldNode = oldNodeMap.get(node.path);
    const childrenToMerge = node.children || oldNode?.children;
    return {
      ...node,
      isOpen: openPaths.has(node.path),
      children: childrenToMerge
        ? mergeOpenState(childrenToMerge, oldNode?.children || [], openPaths)
        : undefined,
    };
  });
};
