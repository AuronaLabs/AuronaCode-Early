// 终端相关数据类型（从 TerminalService 迁出，解除循环依赖）

export interface ShellProfile {
  id: string;
  name: string;
  path: string;
  icon: string;
}

export interface TerminalInstance {
  id: string;
  name: string;
  shell: ShellProfile;
  cwd?: string;
}
