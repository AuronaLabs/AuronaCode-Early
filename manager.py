#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Aurona Code 的交互式开发管理器。

该脚本只封装仓库已有的 pnpm、Cargo、Tauri 与 Git 命令，不参与应用运行时。
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Sequence

try:
    from rich import box
    from rich.console import Console
    from rich.panel import Panel
    from rich.prompt import Confirm, Prompt
    from rich.table import Table
    from rich.text import Text
except ImportError:
    print("Aurona Manager 需要可选依赖 rich。")
    print(f"请运行：{sys.executable} -m pip install rich")
    raise SystemExit(2)


ROOT = Path(__file__).resolve().parent
TAURI_CONFIG = ROOT / "src-tauri" / "tauri.conf.json"
PACKAGE_JSON = ROOT / "package.json"
CARGO_TOML = ROOT / "src-tauri" / "Cargo.toml"
CARGO_LOCK = ROOT / "src-tauri" / "Cargo.lock"
SECURITY_POLICY = ROOT / ".github" / "SECURITY.md"
README = ROOT / "README.md"
SPLASH_HTML = ROOT / "splash.html"
PACKAGE_MANAGER = "pnpm"
PACKAGE_MANAGER_VERSION = "11.13.0"
SEMVER_PATTERN = re.compile(r"^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$")
TARGET_WARNING_BYTES = 8 * 1024**3

console = Console(highlight=False)


def directory_size(path: Path) -> int:
    if not path.exists():
        return 0
    total = 0
    for entry in path.rglob("*"):
        try:
            if entry.is_file():
                total += entry.stat().st_size
        except OSError:
            continue
    return total


def human_size(size: int) -> str:
    value = float(size)
    for unit in ("B", "KiB", "MiB", "GiB", "TiB"):
        if value < 1024 or unit == "TiB":
            return f"{value:.1f} {unit}"
        value /= 1024
    return f"{value:.1f} TiB"


def resolve_command(command: str) -> str:
    if os.name == "nt" and command in {"pnpm", "npm", "npx"}:
        return f"{command}.cmd"
    return command


def find_msvc_environment() -> Path | None:
    """Locate a Visual Studio C++ environment without hard-coding one machine."""
    configured = os.environ.get("AURONA_VCVARS")
    if configured and Path(configured).is_file():
        return Path(configured)

    direct_roots: list[Path] = []
    for environment_name in ("VSINSTALLDIR", "VCINSTALLDIR"):
        value = os.environ.get(environment_name)
        if value:
            root = Path(value)
            direct_roots.append(root if environment_name == "VSINSTALLDIR" else root.parent)

    drive_candidates = [Path(f"{drive}:\\") for drive in "CDE" if Path(f"{drive}:\\").exists()]
    for drive in drive_candidates:
        for edition in ("BuildTools", "Community", "Professional", "Enterprise"):
            direct_roots.append(drive / "Program Files (x86)" / "Microsoft Visual Studio" / "2022" / edition)
            direct_roots.append(drive / "Program Files" / "Microsoft Visual Studio" / "2022" / edition)

    installer_root = Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"))
    vswhere_candidates = [
        installer_root / "Microsoft Visual Studio" / "Installer" / "vswhere.exe",
        *[
            drive / "Program Files (x86)" / "Microsoft Visual Studio" / "Installer" / "vswhere.exe"
            for drive in drive_candidates
        ],
    ]
    for vswhere in vswhere_candidates:
        if not vswhere.exists():
            continue
        installation = capture(
            [
                str(vswhere),
                "-latest",
                "-products",
                "*",
                "-requires",
                "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
                "-property",
                "installationPath",
            ]
        )
        if installation:
            direct_roots.insert(0, Path(installation))

    for root in direct_roots:
        build_root = root / "VC" / "Auxiliary" / "Build"
        for name in ("vcvars64.bat", "vcvars32.bat"):
            candidate = build_root / name
            if candidate.exists():
                return candidate
    return None


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def read_cargo_version() -> str:
    content = CARGO_TOML.read_text(encoding="utf-8")
    match = re.search(r'(?ms)^\[package\].*?^version\s*=\s*"([^"]+)"', content)
    return match.group(1) if match else "unknown"


def read_lock_version() -> str:
    if not CARGO_LOCK.exists():
        return "missing"
    content = CARGO_LOCK.read_text(encoding="utf-8")
    match = re.search(
        r'\[\[package\]\]\s*\nname = "aurona_code"\s*\nversion = "([^"]+)"',
        content,
    )
    return match.group(1) if match else "unknown"


def replace_cargo_version(version: str) -> None:
    content = CARGO_TOML.read_text(encoding="utf-8")
    updated, count = re.subn(
        r'(?m)^(version\s*=\s*")[^"]+("\s*)$',
        rf"\g<1>{version}\g<2>",
        content,
        count=1,
    )
    if count != 1:
        raise RuntimeError("无法定位 Cargo.toml 的 package.version")
    CARGO_TOML.write_text(updated, encoding="utf-8")


def replace_lock_version(version: str) -> None:
    if not CARGO_LOCK.exists():
        return
    content = CARGO_LOCK.read_text(encoding="utf-8")
    pattern = re.compile(r'(\[\[package\]\]\s*\nname = "aurona_code"\s*\nversion = ")[^"]+("\s*)')
    updated, count = pattern.subn(rf"\g<1>{version}\g<2>", content, count=1)
    if count != 1:
        raise RuntimeError("无法定位 Cargo.lock 中的 aurona_code 根包")
    CARGO_LOCK.write_text(updated, encoding="utf-8")


def replace_security_version(version: str) -> None:
    if not SECURITY_POLICY.exists():
        return
    content = SECURITY_POLICY.read_text(encoding="utf-8")
    content = re.sub(
        r"\|\s*[0-9]+\.[0-9]+\.[0-9]+\s*\|\s*:white_check_mark:\s*\|",
        f"| {version} | :white_check_mark: |",
        content,
        count=1,
    )
    content = re.sub(
        r"\|\s*<\s*[0-9]+\.[0-9]+\.[0-9]+\s*\|\s*:x:\s*\|",
        f"| < {version} | :x: |",
        content,
        count=1,
    )
    SECURITY_POLICY.write_text(content, encoding="utf-8")


def read_readme_version() -> str:
    if not README.exists():
        return "missing"
    match = re.search(
        r"img\.shields\.io/badge/version-([0-9A-Za-z.-]+)-",
        README.read_text(encoding="utf-8"),
    )
    return match.group(1) if match else "unknown"


def replace_readme_version(version: str) -> None:
    content = README.read_text(encoding="utf-8")
    updated, count = re.subn(
        r"(img\.shields\.io/badge/version-)[0-9A-Za-z.-]+(-)",
        rf"\g<1>{version}\g<2>",
        content,
        count=1,
    )
    if count != 1:
        raise RuntimeError("无法定位 README.md 中的版本徽章")
    README.write_text(updated, encoding="utf-8")


def read_splash_version() -> str:
    if not SPLASH_HTML.exists():
        return "missing"
    match = re.search(
        r'<div class="splash__version"><span>v([0-9A-Za-z.-]+)</span></div>',
        SPLASH_HTML.read_text(encoding="utf-8"),
    )
    return match.group(1) if match else "unknown"


def replace_splash_version(version: str) -> None:
    content = SPLASH_HTML.read_text(encoding="utf-8")
    updated, count = re.subn(
        r'(<div class="splash__version"><span>v)[0-9A-Za-z.-]+(</span></div>)',
        rf"\g<1>{version}\g<2>",
        content,
        count=1,
    )
    if count != 1:
        raise RuntimeError("无法定位 splash.html 中的版本")
    SPLASH_HTML.write_text(updated, encoding="utf-8")


def command_display(command: Sequence[str]) -> str:
    return " ".join(f'"{item}"' if " " in item else item for item in command)


def run_command(
    command: Sequence[str],
    description: str,
    *,
    stop_on_error: bool = False,
) -> bool:
    resolved = [resolve_command(command[0]), *command[1:]]
    execution: Sequence[str] | str = resolved
    use_shell = False
    msvc_environment: Path | None = None
    if os.name == "nt" and command[0] == "cargo" and shutil.which("cl.exe") is None:
        msvc_environment = find_msvc_environment()
        if msvc_environment:
            cargo_command = subprocess.list2cmdline(resolved)
            execution = f'call "{msvc_environment}" >nul && {cargo_command}'
            use_shell = True
    console.print()
    console.print(
        Panel.fit(
            f"[bold]{description}[/bold]\n[dim]{command_display(resolved)}[/dim]",
            border_style="bright_blue",
            padding=(0, 1),
        )
    )
    if msvc_environment:
        console.print(f"[dim]使用 MSVC 环境：{msvc_environment.name}[/dim]")
    started = time.perf_counter()
    try:
        result = subprocess.run(execution, cwd=ROOT, check=False, shell=use_shell)
    except FileNotFoundError:
        console.print(f"[bold red]找不到命令：{resolved[0]}[/bold red]")
        if stop_on_error:
            raise SystemExit(1)
        return False
    elapsed = time.perf_counter() - started
    if result.returncode == 0:
        console.print(f"[bold green][OK] 已完成[/bold green] [dim]{elapsed:.1f}s[/dim]")
        return True
    console.print(
        f"[bold red][FAIL] 执行失败[/bold red] [dim]退出码 {result.returncode}，耗时 {elapsed:.1f}s[/dim]"
    )
    if stop_on_error:
        raise SystemExit(result.returncode)
    return False


def capture(command: Sequence[str]) -> str | None:
    resolved = [resolve_command(command[0]), *command[1:]]
    try:
        result = subprocess.run(
            resolved,
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
    except FileNotFoundError:
        return None
    if result.returncode != 0:
        return None
    return result.stdout.strip()


def version_snapshot() -> dict[str, str]:
    package = read_json(PACKAGE_JSON)
    tauri = read_json(TAURI_CONFIG)
    return {
        "package.json": str(package.get("version", "unknown")),
        "tauri.conf.json": str(tauri.get("version", "unknown")),
        "Cargo.toml": read_cargo_version(),
        "Cargo.lock": read_lock_version(),
        "README badge": read_readme_version(),
        "splash.html": read_splash_version(),
    }


def git_snapshot() -> tuple[str, str]:
    branch = capture(["git", "branch", "--show-current"]) or "未检测"
    status = capture(["git", "status", "--short"])
    if status is None:
        return branch, "Git 不可用"
    changed = len([line for line in status.splitlines() if line.strip()])
    return branch, "工作区干净" if changed == 0 else f"{changed} 个变更"


def clear_screen() -> None:
    console.clear()


def show_menu() -> None:
    clear_screen()
    versions = version_snapshot()
    branch, working_tree = git_snapshot()
    aligned = len(set(versions.values())) == 1
    target_size = directory_size(ROOT / "src-tauri" / "target")

    title = Text("AURONA MANAGER", style="bold bright_cyan")
    title.append("  ·  desktop workspace", style="dim")
    console.print(Panel.fit(title, border_style="bright_cyan", padding=(0, 2)))

    status = Table.grid(expand=True, padding=(0, 1))
    status.add_column(style="dim", width=12)
    status.add_column(style="bold white")
    status.add_column(style="dim", width=12)
    status.add_column(style="white")
    status.add_row(
        "版本",
        versions["package.json"] + ("" if aligned else "  [red]不一致[/red]"),
        "Git",
        f"{branch} · {working_tree}",
    )
    status.add_row("工作区", str(ROOT), "包管理器", f"pnpm {PACKAGE_MANAGER_VERSION}")
    target_label = human_size(target_size)
    if target_size >= TARGET_WARNING_BYTES:
        target_label += "  [bold yellow]体积过大[/bold yellow]"
    status.add_row("Rust target", target_label, "警告阈值", human_size(TARGET_WARNING_BYTES))
    console.print(Panel(status, border_style="grey35", padding=(0, 1)))

    menu = Table(box=box.SIMPLE, show_header=True, header_style="bold bright_blue", expand=True)
    menu.add_column("编号", width=6, justify="center")
    menu.add_column("操作", ratio=2)
    menu.add_column("说明", ratio=3, style="dim")
    rows = [
        ("1", "启动桌面开发环境", "pnpm run tauri:dev"),
        ("2", "构建前端资源", "类型检查 + Vite production build"),
        ("3", "构建安装包", "预检后执行当前平台 Tauri build"),
        ("4", "运行质量门禁", "前端、边界、smoke、测试与 Rust 检查"),
        ("5", "环境诊断", "只读检查 Node、pnpm、Rust、Tauri 与 Git"),
        ("6", "安装冻结依赖", "pnpm install --frozen-lockfile"),
        ("7", "同步工程版本", "package、Tauri、Cargo、lock 与安全策略"),
        ("8", "编辑打包配置", "修改受支持的 Tauri 基础字段"),
        ("9", "清理构建缓存", "删除 Dist 与 src-tauri/target"),
        ("10", "查看 Git 概览", "分支、最近提交与当前改动"),
        ("0", "退出", "不执行任何操作"),
    ]
    for number, label, detail in rows:
        menu.add_row(number, label, detail)
    console.print(menu)


def pause() -> None:
    Prompt.ask("\n[dim]按 Enter 返回主菜单[/dim]", default="")


def environment_report() -> bool:
    checks = [
        ("Node.js", ["node", "--version"]),
        ("pnpm", [PACKAGE_MANAGER, "--version"]),
        ("Rust", ["rustc", "--version"]),
        ("Cargo", ["cargo", "--version"]),
        ("Tauri CLI", [PACKAGE_MANAGER, "exec", "tauri", "--version"]),
        ("Git", ["git", "--version"]),
    ]
    table = Table(title="开发环境诊断", box=box.ROUNDED, header_style="bold bright_blue")
    table.add_column("工具", style="bold")
    table.add_column("状态", width=10)
    table.add_column("检测结果", style="dim")
    ok = True
    for name, command in checks:
        value = capture(command)
        available = value is not None
        ok = ok and available
        table.add_row(name, "[green]可用[/green]" if available else "[red]缺失[/red]", value or "未找到")
    if os.name == "nt":
        msvc = find_msvc_environment()
        available = shutil.which("cl.exe") is not None or msvc is not None
        ok = ok and available
        table.add_row(
            "MSVC C++",
            "[green]可用[/green]" if available else "[red]缺失[/red]",
            "当前终端已加载" if shutil.which("cl.exe") else str(msvc or "未找到 Build Tools"),
        )
    console.print(table)
    if not ok:
        console.print(
            "[yellow]管理器不会自动安装系统工具。请根据 README 的开发环境章节完成配置。[/yellow]"
        )
    elif capture([PACKAGE_MANAGER, "--version"]) != PACKAGE_MANAGER_VERSION:
        console.print(
            f"[yellow]当前 pnpm 与仓库固定版本 {PACKAGE_MANAGER_VERSION} 不同，建议通过 Corepack 对齐。[/yellow]"
        )
    return ok


QUALITY_STEPS: list[tuple[list[str], str]] = [
    ([PACKAGE_MANAGER, "run", "typecheck"], "TypeScript 类型检查"),
    ([PACKAGE_MANAGER, "run", "check"], "Biome 代码质量检查"),
    ([PACKAGE_MANAGER, "run", "check:boundaries"], "桌面边界检查"),
    ([PACKAGE_MANAGER, "run", "check:materials"], "Material 边界检查"),
    ([PACKAGE_MANAGER, "run", "smoke"], "发布元数据 smoke"),
    ([PACKAGE_MANAGER, "run", "test:frontend"], "前端测试"),
    ([PACKAGE_MANAGER, "run", "build"], "前端生产构建"),
    (["cargo", "fmt", "--manifest-path", "src-tauri/Cargo.toml", "--", "--check"], "Rust 格式检查"),
    (
        [
            "cargo",
            "clippy",
            "--manifest-path",
            "src-tauri/Cargo.toml",
            "--locked",
            "--all-targets",
            "--",
            "-D",
            "warnings",
        ],
        "Rust Clippy",
    ),
    (["cargo", "check", "--manifest-path", "src-tauri/Cargo.toml", "--locked"], "Rust check"),
    (["cargo", "test", "--manifest-path", "src-tauri/Cargo.toml", "--locked"], "Rust tests"),
]


def run_quality_gate() -> bool:
    console.print(Panel("按 CI 顺序执行完整本地质量门禁", border_style="magenta"))
    for command, description in QUALITY_STEPS:
        if not run_command(command, description):
            console.print(f"[bold red]质量门禁在“{description}”停止。[/bold red]")
            return False
    console.print("\n[bold green][OK] 全部质量门禁通过[/bold green]")
    return True


def sync_versions() -> None:
    versions = version_snapshot()
    table = Table(title="工程版本", box=box.ROUNDED, header_style="bold cyan")
    table.add_column("文件")
    table.add_column("当前版本", style="bold")
    for file, version in versions.items():
        table.add_row(file, version)
    console.print(table)

    current = versions["package.json"]
    new_version = Prompt.ask("目标版本", default=current).strip()
    if not SEMVER_PATTERN.fullmatch(new_version):
        console.print("[bold red]版本格式无效，请使用 0.3.0 或 0.3.0-beta.1 形式。[/bold red]")
        return
    if new_version == current and len(set(versions.values())) == 1:
        console.print("[dim]所有版本文件已经一致，无需修改。[/dim]")
        return
    if not Confirm.ask(f"确认将工程版本同步为 {new_version}？", default=False):
        return

    package = read_json(PACKAGE_JSON)
    tauri = read_json(TAURI_CONFIG)
    package["version"] = new_version
    tauri["version"] = new_version
    write_json(PACKAGE_JSON, package)
    write_json(TAURI_CONFIG, tauri)
    replace_cargo_version(new_version)
    replace_lock_version(new_version)
    replace_security_version(new_version)
    replace_readme_version(new_version)
    replace_splash_version(new_version)
    console.print(
        "[bold green][OK] 已同步 package、Tauri、Cargo、Cargo.lock、安全策略、README 徽章和 splash.html 版本[/bold green]"
    )
    console.print(
        "[yellow]仍需人工更新 ChangelogData、Release Notes，并运行 pnpm run smoke；管理器不会生成虚假更新记录。[/yellow]"
    )


def edit_build_config() -> None:
    while True:
        data = read_json(TAURI_CONFIG)
        bundle = data.setdefault("bundle", {})
        windows = bundle.setdefault("windows", {})
        nsis = windows.setdefault("nsis", {})

        table = Table(title="Tauri 打包配置", box=box.ROUNDED, header_style="bold blue")
        table.add_column("编号", width=6, justify="center")
        table.add_column("字段")
        table.add_column("当前值", style="bold")
        table.add_row("1", "productName", str(data.get("productName", "")))
        table.add_row("2", "identifier", str(data.get("identifier", "")))
        table.add_row("3", "NSIS installMode", str(nsis.get("installMode", "未设置")))
        table.add_row("4", "NSIS displayLanguageSelector", str(nsis.get("displayLanguageSelector", "未设置")))
        table.add_row("0", "返回", "不再修改")
        console.print(table)
        choice = Prompt.ask("选择字段", choices=["0", "1", "2", "3", "4"], default="0")
        if choice == "0":
            return
        if choice == "1":
            data["productName"] = Prompt.ask("应用名称", default=str(data.get("productName", "Aurona Code")))
        elif choice == "2":
            data["identifier"] = Prompt.ask("应用标识", default=str(data.get("identifier", "com.aurona.code")))
        elif choice == "3":
            nsis["installMode"] = Prompt.ask(
                "安装模式",
                choices=["currentUser", "perMachine", "both"],
                default=str(nsis.get("installMode", "perMachine")),
            )
        elif choice == "4":
            nsis["displayLanguageSelector"] = Confirm.ask(
                "安装时显示语言选择器？",
                default=bool(nsis.get("displayLanguageSelector", False)),
            )
        write_json(TAURI_CONFIG, data)
        console.print("[green][OK] 配置已保存[/green]")


def build_distribution() -> None:
    versions = version_snapshot()
    if len(set(versions.values())) != 1:
        console.print("[bold red]版本文件不一致，请先执行“同步工程版本”。[/bold red]")
        return
    data = read_json(TAURI_CONFIG)
    summary = Table(box=box.ROUNDED, title="当前平台 Release 构建", header_style="bold cyan")
    summary.add_column("项目")
    summary.add_column("值", style="bold")
    summary.add_row("产品", str(data.get("productName")))
    summary.add_row("版本", versions["package.json"])
    summary.add_row("标识", str(data.get("identifier")))
    summary.add_row("输出", "src-tauri/target/release/bundle")
    console.print(summary)
    if not Confirm.ask("先运行 smoke 与前端测试，再开始打包？", default=True):
        return
    if not run_command([PACKAGE_MANAGER, "run", "smoke"], "发布元数据 smoke"):
        return
    if not run_command([PACKAGE_MANAGER, "run", "test:frontend"], "前端测试"):
        return
    run_command([PACKAGE_MANAGER, "run", "tauri:build"], "Tauri Release 构建")


def clean_build_outputs() -> None:
    targets = [ROOT / "Dist", ROOT / "src-tauri" / "target"]
    existing = [path for path in targets if path.exists()]
    if not existing:
        console.print("[dim]没有可清理的构建目录。[/dim]")
        return
    console.print("将删除：")
    target = ROOT / "src-tauri" / "target"
    target_size = directory_size(target)
    if target in existing and target_size >= TARGET_WARNING_BYTES:
        if not Confirm.ask(
            f"src-tauri/target 当前占用 {human_size(target_size)}，删除后需要重新编译依赖。再次确认清理？",
            default=False,
        ):
            return
    for path in existing:
        console.print(f"  [yellow]{path.relative_to(ROOT)}[/yellow]")
    if not Confirm.ask("确认清理这些构建产物？", default=False):
        return
    for path in existing:
        resolved = path.resolve()
        if ROOT not in resolved.parents:
            raise RuntimeError(f"拒绝清理工作区外路径：{resolved}")
        shutil.rmtree(resolved)
        console.print(f"[green][OK] 已删除 {path.relative_to(ROOT)}[/green]")


def show_git_overview() -> None:
    if capture(["git", "--version"]) is None:
        console.print("[red]Git 不可用。[/red]")
        return
    branch, state = git_snapshot()
    remote = capture(["git", "remote", "get-url", "origin"]) or "未配置 origin"
    last_commit = capture(["git", "log", "-1", "--pretty=format:%h  %s  (%cr)"]) or "无提交"
    table = Table(title="Git 工作区", box=box.ROUNDED, header_style="bold magenta")
    table.add_column("项目", width=12, style="dim")
    table.add_column("值")
    table.add_row("分支", branch)
    table.add_row("状态", state)
    table.add_row("远端", remote)
    table.add_row("最近提交", last_commit)
    console.print(table)
    status = capture(["git", "status", "--short"])
    if status:
        lines = status.splitlines()
        preview = lines[:18]
        if len(lines) > len(preview):
            preview.append(f"... 其余 {len(lines) - len(preview)} 项请使用 git status --short 查看")
        console.print(Panel("\n".join(preview), title="当前改动（摘要）", border_style="yellow"))


def interactive_main() -> None:
    while True:
        show_menu()
        choice = Prompt.ask(
            "选择操作",
            choices=[str(number) for number in range(0, 11)],
            default="1",
        )
        if choice == "0":
            console.print("[dim]Aurona Manager 已退出。[/dim]")
            return
        if choice == "1":
            run_command([PACKAGE_MANAGER, "run", "tauri:dev"], "启动 Tauri 开发环境")
        elif choice == "2":
            run_command([PACKAGE_MANAGER, "run", "build"], "构建前端生产资源")
        elif choice == "3":
            build_distribution()
        elif choice == "4":
            run_quality_gate()
        elif choice == "5":
            environment_report()
        elif choice == "6":
            run_command([PACKAGE_MANAGER, "install", "--frozen-lockfile"], "安装冻结依赖")
        elif choice == "7":
            sync_versions()
        elif choice == "8":
            edit_build_config()
        elif choice == "9":
            clean_build_outputs()
        elif choice == "10":
            show_git_overview()
        pause()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Aurona Code developer manager")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--dev", action="store_true", help="直接启动 Tauri 开发环境")
    group.add_argument("--check", action="store_true", help="直接运行完整质量门禁")
    group.add_argument("--status", action="store_true", help="输出环境与 Git 状态")
    return parser.parse_args()


def main() -> int:
    if not TAURI_CONFIG.exists() or not PACKAGE_JSON.exists():
        console.print(f"[bold red]无法定位 Aurona Code 工作区：{ROOT}[/bold red]")
        return 1
    os.chdir(ROOT)
    args = parse_args()
    if args.dev:
        return 0 if run_command([PACKAGE_MANAGER, "run", "tauri:dev"], "启动 Tauri 开发环境") else 1
    if args.check:
        return 0 if run_quality_gate() else 1
    if args.status:
        environment_report()
        show_git_overview()
        return 0
    interactive_main()
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        console.print("\n[dim]操作已中止。[/dim]")
        raise SystemExit(130)
