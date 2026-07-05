

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
