# -*- coding: utf-8 -*-
import os
import sys
import json
import re
import subprocess
import time
import uuid

def install_and_import(package):
    try:
        __import__(package)
    except ImportError:
        print(f"[{package}] 未找到，正在安装核心依赖...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", package, "-q"])

install_and_import('rich')

from rich.console import Console
from rich.panel import Panel
from rich.prompt import Prompt, Confirm
from rich import print as rprint
from rich.table import Table

console = Console()
TAURI_CONF = 'src-tauri/tauri.conf.json'
PACKAGE_JSON = 'package.json'
CARGO_TOML  = 'src-tauri/Cargo.toml'

def read_json(path):
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)

def write_json(path, data):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write('\n')

def read_cargo_version():
    """从 Cargo.toml [package] 节读取版本号"""
    with open(CARGO_TOML, 'r', encoding='utf-8') as f:
        content = f.read()
    # 只匹配 [package] 节下的第一个 version = "..."
    Match = re.search(r'(?s)\[package\].*?^version\s*=\s*"([^"]+)"', content, re.MULTILINE)
    return Match.group(1) if Match else 'unknown'

def write_cargo_version(NewVersion):
    """替换 Cargo.toml [package] 节中的版本号"""
    with open(CARGO_TOML, 'r', encoding='utf-8') as f:
        Content = f.read()
    # 仅替换 [package] 节之后第一个 version 字段
    Updated = re.sub(
        r'(\[package\].*?^version\s*=\s*")([^"]+)(")',
        lambda M: M.group(1) + NewVersion + M.group(3),
        Content, count=1, flags=re.MULTILINE | re.DOTALL
    )
    with open(CARGO_TOML, 'w', encoding='utf-8') as f:
        f.write(Updated)

def write_security_version(NewVersion):
    """更新 SECURITY.md 中的支持版本号"""
    sec_path = ".github/SECURITY.md"
    if not os.path.exists(sec_path):
        return
    with open(sec_path, 'r', encoding='utf-8') as f:
        Content = f.read()
    
    # 替换 | x.x.x | :white_check_mark: | 这种格式的当前版本
    # 这里我们使用正则精确匹配表格中的支持行
    Updated = re.sub(
        r'\|\s*([0-9\.]+)\s*\|\s*:white_check_mark:\s*\|',
        f'| {NewVersion}   | :white_check_mark: |',
        Content, count=1
    )
    # 替换下面的一行旧版本
    Updated = re.sub(
        r'\|\s*<\s*([0-9\.]+)\s*\|\s*:x:\s*\|',
        f'| < {NewVersion} | :x:                |',
        Updated, count=1
    )
    
    with open(sec_path, 'w', encoding='utf-8') as f:
        f.write(Updated)

def run_command(command, description):
    console.print(f"\n[bold blue]:: {description} ::[/bold blue]")
    try:
        subprocess.run(command, shell=True, check=True)
        console.print(f"[bold green]✓ 任务完成 ({description})[/bold green]\n")
    except subprocess.CalledProcessError:
        console.print(f"[bold red]✗ 任务失败 ({description})，请检查日志。[/bold red]\n")
        sys.exit(1)

def show_menu():
    os.system('cls' if os.name == 'nt' else 'clear')
    try:
        data = read_json(TAURI_CONF)
        version = data.get('version', 'Unknown')
    except Exception:
        version = 'Error Reading Config'
    
    title = "[bold white]AURONA CODE - BUILD SYSTEM (TAURI)[/bold white]"
    content = f"""[dim]Version:[/dim] [white]{version}[/white]
[dim]Workspace:[/dim] {os.getcwd()}

[bold white][ 1 ][/bold white] 启动开发环境 (Tauri Dev)
[bold white][ 2 ][/bold white] 安装依赖项 (Install Dependencies)
[bold white][ 3 ][/bold white] 清理构建缓存 (Clean Targets)
[bold white][ 4 ][/bold white] 修改应用版本号 (Sync Version across packages)
[bold white][ 5 ][/bold white] 编译前端静态资源 (Vite Build)
[bold white][ 6 ][/bold white] 生成标准安装包 (Tauri Build / NSIS)
[bold white][ 7 ][/bold white] ⚙️ 配置打包参数 (Edit Tauri Config & GUID)
[bold white][ 0 ][/bold white] 退出 (Exit)
"""
    console.print(Panel(content, title=title, border_style="cyan", padding=(1, 2)))

def update_versions():
    TauriData = read_json(TAURI_CONF)
    PkgData   = read_json(PACKAGE_JSON)
    CargoVer  = read_cargo_version()

    # 以 tauri.conf.json 为版本基准
    Current = TauriData.get('version', '1.0.0')

    # 展示三个文件的当前版本，让用户一眼看清是否一致
    Table_ = Table(show_header=True, header_style="bold cyan", box=None)
    Table_.add_column("文件",         style="dim",   width=28)
    Table_.add_column("当前版本号",   style="white")
    Table_.add_row("tauri.conf.json",   Current)
    Table_.add_row("package.json",       PkgData.get('version', '?'))
    Table_.add_row("src-tauri/Cargo.toml", CargoVer)
    console.print(Table_)

    NewVersion = Prompt.ask("\n请输入新版本号", default=Current)

    if NewVersion != Current:
        TauriData['version'] = NewVersion
        PkgData['version']   = NewVersion
        write_json(TAURI_CONF, TauriData)
        write_json(PACKAGE_JSON, PkgData)
        write_cargo_version(NewVersion)
        write_security_version(NewVersion)
        console.print(f"[bold green]✓ 四端版本号已全量同步: {NewVersion}[/bold green]")
        console.print("  [dim]→ tauri.conf.json / package.json / Cargo.toml / SECURITY.md[/dim]")
    else:
        console.print("[dim]版本号未变更[/dim]")
    time.sleep(1.5)

def edit_build_config():
    while True:
        os.system('cls' if os.name == 'nt' else 'clear')
        data = read_json(TAURI_CONF)
        
        bundle_cfg = data.get('bundle', {})
        windows_cfg = bundle_cfg.get('windows', {})
        nsis_cfg = windows_cfg.get('nsis', {})
        
        if 'upgradeCode' not in bundle_cfg.get('windows', {}):
            windows_cfg.setdefault('nsis', {})
            windows_cfg.setdefault('wix', {})
            
        console.print("\n[bold white]--- 交互式 Tauri 打包配置编辑器 ---[/bold white]")
        table = Table(show_header=True, header_style="bold blue", box=None)
        table.add_column("序号", style="dim")
        table.add_column("配置项 (Key)", style="cyan")
        table.add_column("当前值 (Value)", style="bold white")
        
        table.add_row("1", "productName (应用名称)", str(data.get('productName', '')))
        table.add_row("2", "identifier (应用标识)", str(data.get('identifier', '')))
        table.add_row("3", "installMode (NSIS 安装模式)", str(nsis_cfg.get('installMode', '未设置')))
        table.add_row("4", "displayLanguageSelector (NSIS 语言选择)", str(nsis_cfg.get('displayLanguageSelector', '未设置')))
        # Show upgrade code (GUID)
        upgrade_code = windows_cfg.get('wix', {}).get('upgradeCode', '') or windows_cfg.get('nsis', {}).get('installMode', 'Not explicitly set')
        # Actually in Tauri, you can set upgradeCode on windows level or nsis level
        upgrade_code = windows_cfg.get('wix', {}).get('upgradeCode', '未设置') 
        # But for nsis it's under NSIS typically or Windows globally in tauri.conf
        # Let's put it globally under windows: upgradeCode
        # Tauri v2 expects upgradeCode? No, wait. 
        # Let's just manage an upgradeCode string in windows.upgradeCode
        # "windows": { "nsis": {...} }
        current_guid = windows_cfg.get('upgradeCode', '')
        table.add_row("5", "upgradeCode / GUID (安装包唯一标识)", str(current_guid))
        
        console.print(table)
        console.print("\n[dim]提示：输入序号即可修改对应配置，输入 0 返回主菜单。[/dim]")
        
        choice = Prompt.ask("请选择要修改的项", default="0")
        if choice == "0":
            break
            
        def update_val(prompt_text, current_val, is_bool=False):
            if is_bool:
                new_v = Prompt.ask(f"请输入 {prompt_text} (true/false)", default=str(current_val).lower())
                return new_v.lower() == 'true'
            else:
                return Prompt.ask(f"请输入 {prompt_text}", default=str(current_val))
                
        if choice == "1":
            data['productName'] = update_val("productName", data.get('productName', ''))
        elif choice == "2":
            data['identifier'] = update_val("identifier", data.get('identifier', ''))
        elif choice == "3":
            nsis_cfg['installMode'] = update_val("installMode (perMachine / currentUser / both)", nsis_cfg.get('installMode', ''))
        elif choice == "4":
            nsis_cfg['displayLanguageSelector'] = update_val("displayLanguageSelector", nsis_cfg.get('displayLanguageSelector', ''), is_bool=True)
        elif choice == "5":
            new_guid = str(uuid.uuid4())
            if Confirm.ask(f"是否生成一个新的随机 GUID? (例如: {new_guid})", default=True):
                windows_cfg['upgradeCode'] = new_guid
                nsis_cfg['upgradeCode'] = new_guid # Provide for both locations just in case
            else:
                manual_guid = Prompt.ask("请输入自定义 GUID", default=str(current_guid))
                windows_cfg['upgradeCode'] = manual_guid
                nsis_cfg['upgradeCode'] = manual_guid
                
        windows_cfg['nsis'] = nsis_cfg
        bundle_cfg['windows'] = windows_cfg
        data['bundle'] = bundle_cfg
        
        write_json(TAURI_CONF, data)
        console.print("[bold green]✓ 配置已实时保存到 tauri.conf.json！[/bold green]")
        time.sleep(0.5)

def handle_distribution():
    data = read_json(TAURI_CONF)
    
    console.print("\n[bold white]--- Tauri 生产包构建配置审核 ---[/bold white]")
    table = Table(show_header=False, box=None)
    table.add_column("配置项 (Key)", style="dim")
    table.add_column("当前值 (Value)", style="bold white")
    table.add_column("配置说明 (Description)", style="cyan")
    
    table.add_row("应用名称 (productName):", data.get('productName', '未设置'), "安装包显示的软件名称")
    table.add_row("应用标识 (identifier):", data.get('identifier', '未设置'), "软件唯一包名")
    table.add_row("当前版本 (version):", data.get('version', '未设置'), "打包输出的版本号")
    
    windows_cfg = data.get('bundle', {}).get('windows', {})
    nsis_cfg = windows_cfg.get('nsis', {})
    console.print(table)
    
    console.print("\n[bold white]--- Windows 安装包高级配置 ---[/bold white]")
    nsis_table = Table(show_header=False, box=None)
    nsis_table.add_column("配置项 (Key)", style="dim")
    nsis_table.add_column("当前值 (Value)", style="bold yellow")
    nsis_table.add_column("配置说明 (Description)", style="cyan")

    nsis_table.add_row("安装模式 (installMode):", str(nsis_cfg.get('installMode', '未设置')), "perMachine=所有用户(需管理员权限), currentUser=当前用户")
    nsis_table.add_row("显示语言选择器 (displayLanguageSelector):", str(nsis_cfg.get('displayLanguageSelector', '未设置')), "安装时是否弹出语言选择框")
    nsis_table.add_row("升级标识码 (upgradeCode):", str(windows_cfg.get('upgradeCode', '未设置')), "GUID，标识该软件用于替换旧版本")
    
    console.print(nsis_table)
    
    console.print("\n[bold red]注意：打包流程将调用 Rust 编译器进行全量构建，耗时较长。[/bold red]")
    if not Confirm.ask("确认使用上述配置进行打包吗？"):
        console.print("[dim]已取消打包流程。[/dim]")
        return
        
    console.print("\n[bold blue]开始执行 Tauri 生产构建流水线... (可能会花费几分钟，请勿关闭终端)[/bold blue]")
    run_command("npm run tauri:build", "执行 Tauri 构建 (Cargo Release)")
    console.print("[bold green]✓ 构建成功！安装包已输出至 src-tauri/target/release/bundle 目录。[/bold green]")
    input("\n按回车键返回主菜单...")

def main():
    while True:
        show_menu()
        choice = Prompt.ask("请选择操作编号", choices=["0", "1", "2", "3", "4", "5", "6", "7"], default="1")
        
        if choice == "1":
            console.print("\n[bold blue]:: 启动 Tauri 开发服务器... (Ctrl+C 中止) ::[/bold blue]")
            try:
                subprocess.run("npm run tauri:dev", shell=True)
            except KeyboardInterrupt:
                console.print("\n[dim]已终止进程。[/dim]")
            time.sleep(1)
            
        elif choice == "2":
            run_command("npm install", "安装项目前端依赖")
            time.sleep(1)
            
        elif choice == "3":
            console.print("\n[bold blue]:: 清理工作区 ::[/bold blue]")
            if os.path.exists("Dist"):
                subprocess.run("rmdir /s /q Dist", shell=True)
                console.print("[dim]清理前端 Dist 目录...[/dim]")
            if os.path.exists("src-tauri/target"):
                subprocess.run("rmdir /s /q src-tauri\\target", shell=True)
                console.print("[dim]清理 Rust target 目录...[/dim]")
            console.print("[bold green]✓ 清理完成[/bold green]")
            time.sleep(1)
            
        elif choice == "4":
            update_versions()
            
        elif choice == "5":
            run_command("npm run build", "编译前端静态资源")
            time.sleep(1)
            
        elif choice == "6":
            handle_distribution()
            
        elif choice == "7":
            edit_build_config()
            
        elif choice == "0":
            console.print("\n[dim]进程已结束。[/dim]\n")
            break

if __name__ == "__main__":
    try:
        if not os.path.exists(TAURI_CONF):
            console.print(f"[bold red]错误：找不到 {TAURI_CONF}，请确保在项目根目录运行！[/bold red]")
            sys.exit(1)
        main()
    except Exception as e:
        console.print(f"\n[bold red]发生意外错误: {e}[/bold red]")
    finally:
        os.system("pause")
