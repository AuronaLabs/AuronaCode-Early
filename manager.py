# -*- coding: utf-8 -*-
import os
import sys
import json
import re
import subprocess
import time
import uuid

def InstallAndImport(Package):
    try:
        __import__(Package)
    except ImportError:
        print(f"[{Package}] 未找到，正在安装核心依赖...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", Package, "-q"])

InstallAndImport('rich')

from rich.console import Console
from rich.panel import Panel
from rich.prompt import Prompt, Confirm
from rich import print as RPrint
from rich.table import Table

ConsoleInstance = Console()
TauriConf = 'src-tauri/tauri.conf.json'
PackageJson = 'package.json'
CargoToml  = 'src-tauri/Cargo.toml'

def ReadJson(Path):
    with open(Path, 'r', encoding='utf-8') as File:
        return json.load(File)

def WriteJson(Path, Data):
    with open(Path, 'w', encoding='utf-8') as File:
        json.dump(Data, File, indent=2, ensure_ascii=False)
        File.write('\n')

def ReadCargoVersion():
    """从 Cargo.toml [package] 节读取版本号"""
    with open(CargoToml, 'r', encoding='utf-8') as File:
        Content = File.read()
    Match = re.search(r'(?s)\[package\].*?^version\s*=\s*"([^"]+)"', Content, re.MULTILINE)
    return Match.group(1) if Match else 'unknown'

def WriteCargoVersion(NewVersion):
    """替换 Cargo.toml [package] 节中的版本号"""
    with open(CargoToml, 'r', encoding='utf-8') as File:
        Content = File.read()
    Updated = re.sub(
        r'(\[package\].*?^version\s*=\s*")([^"]+)(")',
        lambda M: M.group(1) + NewVersion + M.group(3),
        Content, count=1, flags=re.MULTILINE | re.DOTALL
    )
    with open(CargoToml, 'w', encoding='utf-8') as File:
        File.write(Updated)

def WriteSecurityVersion(NewVersion):
    """更新 SECURITY.md 中的支持版本号"""
    SecPath = ".github/SECURITY.md"
    if not os.path.exists(SecPath):
        return
    with open(SecPath, 'r', encoding='utf-8') as File:
        Content = File.read()
    
    Updated = re.sub(
        r'\|\s*([0-9\.]+)\s*\|\s*:white_check_mark:\s*\|',
        f'| {NewVersion}   | :white_check_mark: |',
        Content, count=1
    )
    Updated = re.sub(
        r'\|\s*<\s*([0-9\.]+)\s*\|\s*:x:\s*\|',
        f'| < {NewVersion} | :x:                |',
        Updated, count=1
    )
    
    with open(SecPath, 'w', encoding='utf-8') as File:
        File.write(Updated)

def RunCommand(Command, Description):
    ConsoleInstance.print(f"\n[bold blue]:: {Description} ::[/bold blue]")
    try:
        subprocess.run(Command, shell=True, check=True)
        ConsoleInstance.print(f"[bold green]✓ 任务完成 ({Description})[/bold green]\n")
    except subprocess.CalledProcessError:
        ConsoleInstance.print(f"[bold red]✗ 任务失败 ({Description})，请检查日志。[/bold red]\n")
        sys.exit(1)

def CheckAndInstallEnvironment():
    ConsoleInstance.print("\n[bold blue]--- 自动环境检查与依赖配置 ---[/bold blue]")
    
    HasNode = False
    try:
        subprocess.run(["node", "--version"], check=True, capture_output=True)
        ConsoleInstance.print("[bold green]✓ Node.js 已就绪[/bold green]")
        HasNode = True
    except Exception:
        ConsoleInstance.print("[bold red]✗ 未检测到 Node.js，请前往 https://nodejs.org 手动安装。[/bold red]")

    HasRust = False
    try:
        subprocess.run(["rustc", "--version"], check=True, capture_output=True)
        ConsoleInstance.print("[bold green]✓ Rust 编译器已就绪[/bold green]")
        HasRust = True
    except Exception:
        ConsoleInstance.print("[bold red]✗ 未检测到 Rust，请前往 https://rustup.rs 手动安装。[/bold red]")
        
    if HasRust:
        try:
            Result = subprocess.run(["cargo", "tauri", "--version"], capture_output=True, text=True)
            if Result.returncode == 0:
                ConsoleInstance.print("[bold green]✓ Tauri CLI 已就绪[/bold green]")
            else:
                raise Exception()
        except Exception:
            ConsoleInstance.print("[yellow]! 未检测到 Tauri CLI，开始全自动安装... (这可能需要几分钟)[/yellow]")
            try:
                subprocess.run(["cargo", "install", "tauri-cli", "--version", "^2.0.0-rc"], check=True)
                ConsoleInstance.print("[bold green]✓ Tauri CLI 自动安装成功！[/bold green]")
            except Exception as Err:
                ConsoleInstance.print(f"[bold red]✗ Tauri CLI 安装失败: {Err}[/bold red]")

    if HasNode and Confirm.ask("\n是否需要自动执行 npm install 以同步前端依赖?", default=True):
        RunCommand("npm install", "安装项目前端依赖")
        
    ConsoleInstance.print("\n[dim]环境检查完成，按回车返回菜单...[/dim]")
    input()

def ShowMenu():
    os.system('cls' if os.name == 'nt' else 'clear')
    try:
        Data = ReadJson(TauriConf)
        Version = Data.get('version', 'Unknown')
    except Exception:
        Version = 'Error Reading Config'
    
    Title = "[bold white]AURONA CODE - BUILD SYSTEM (TAURI)[/bold white]"
    Content = f"""[dim]Version:[/dim] [white]{Version}[/white]
[dim]Workspace:[/dim] {os.getcwd()}

[bold white][ 1 ][/bold white] 启动开发环境 (Tauri Dev)
[bold white][ 2 ][/bold white] 安装前端依赖项 (Install NPM Dependencies)
[bold white][ 3 ][/bold white] 清理构建缓存 (Clean Targets)
[bold white][ 4 ][/bold white] 修改应用版本号 (Sync Version across packages)
[bold white][ 5 ][/bold white] 编译前端静态资源 (Vite Build)
[bold white][ 6 ][/bold white] 生成标准安装包 (Tauri Build / NSIS)
[bold white][ 7 ][/bold white] ⚙️ 配置打包参数 (Edit Tauri Config & GUID)
[bold green][ 8 ][/bold green] 🔧 检查并配置开发环境 (Auto Setup Env)
[bold white][ 0 ][/bold white] 退出 (Exit)
"""
    ConsoleInstance.print(Panel(Content, title=Title, border_style="cyan", padding=(1, 2)))

def UpdateVersions():
    TauriData = ReadJson(TauriConf)
    PkgData   = ReadJson(PackageJson)
    CargoVer  = ReadCargoVersion()

    Current = TauriData.get('version', '1.0.0')

    TableInstance = Table(show_header=True, header_style="bold cyan", box=None)
    TableInstance.add_column("文件",         style="dim",   width=28)
    TableInstance.add_column("当前版本号",   style="white")
    TableInstance.add_row("tauri.conf.json",   Current)
    TableInstance.add_row("package.json",       PkgData.get('version', '?'))
    TableInstance.add_row("src-tauri/Cargo.toml", CargoVer)
    ConsoleInstance.print(TableInstance)

    NewVersion = Prompt.ask("\n请输入新版本号", default=Current)

    if NewVersion != Current:
        TauriData['version'] = NewVersion
        PkgData['version']   = NewVersion
        WriteJson(TauriConf, TauriData)
        WriteJson(PackageJson, PkgData)
        WriteCargoVersion(NewVersion)
        WriteSecurityVersion(NewVersion)
        ConsoleInstance.print(f"[bold green]✓ 四端版本号已全量同步: {NewVersion}[/bold green]")
    else:
        ConsoleInstance.print("[dim]版本号未变更[/dim]")
    time.sleep(1.5)

def EditBuildConfig():
    while True:
        os.system('cls' if os.name == 'nt' else 'clear')
        Data = ReadJson(TauriConf)
        
        BundleCfg = Data.get('bundle', {})
        WindowsCfg = BundleCfg.get('windows', {})
        NsisCfg = WindowsCfg.get('nsis', {})
        
        if 'upgradeCode' not in BundleCfg.get('windows', {}):
            WindowsCfg.setdefault('nsis', {})
            WindowsCfg.setdefault('wix', {})
            
        ConsoleInstance.print("\n[bold white]--- 交互式 Tauri 打包配置编辑器 ---[/bold white]")
        TableInstance = Table(show_header=True, header_style="bold blue", box=None)
        TableInstance.add_column("序号", style="dim")
        TableInstance.add_column("配置项 (Key)", style="cyan")
        TableInstance.add_column("当前值 (Value)", style="bold white")
        
        TableInstance.add_row("1", "productName (应用名称)", str(Data.get('productName', '')))
        TableInstance.add_row("2", "identifier (应用标识)", str(Data.get('identifier', '')))
        TableInstance.add_row("3", "installMode (NSIS 安装模式)", str(NsisCfg.get('installMode', '未设置')))
        TableInstance.add_row("4", "displayLanguageSelector (NSIS 语言选择)", str(NsisCfg.get('displayLanguageSelector', '未设置')))
        CurrentGuid = WindowsCfg.get('upgradeCode', '')
        TableInstance.add_row("5", "upgradeCode / GUID (安装包唯一标识)", str(CurrentGuid))
        
        ConsoleInstance.print(TableInstance)
        ConsoleInstance.print("\n[dim]提示：输入序号即可修改对应配置，输入 0 返回主菜单。[/dim]")
        
        Choice = Prompt.ask("请选择要修改的项", default="0")
        if Choice == "0":
            break
            
        def UpdateVal(PromptText, CurrentVal, IsBool=False):
            if IsBool:
                NewV = Prompt.ask(f"请输入 {PromptText} (true/false)", default=str(CurrentVal).lower())
                return NewV.lower() == 'true'
            else:
                return Prompt.ask(f"请输入 {PromptText}", default=str(CurrentVal))
                
        if Choice == "1":
            Data['productName'] = UpdateVal("productName", Data.get('productName', ''))
        elif Choice == "2":
            Data['identifier'] = UpdateVal("identifier", Data.get('identifier', ''))
        elif Choice == "3":
            NsisCfg['installMode'] = UpdateVal("installMode (perMachine / currentUser / both)", NsisCfg.get('installMode', ''))
        elif Choice == "4":
            NsisCfg['displayLanguageSelector'] = UpdateVal("displayLanguageSelector", NsisCfg.get('displayLanguageSelector', ''), IsBool=True)
        elif Choice == "5":
            NewGuid = str(uuid.uuid4())
            if Confirm.ask(f"是否生成一个新的随机 GUID? (例如: {NewGuid})", default=True):
                WindowsCfg['upgradeCode'] = NewGuid
                NsisCfg['upgradeCode'] = NewGuid
            else:
                ManualGuid = Prompt.ask("请输入自定义 GUID", default=str(CurrentGuid))
                WindowsCfg['upgradeCode'] = ManualGuid
                NsisCfg['upgradeCode'] = ManualGuid
                
        WindowsCfg['nsis'] = NsisCfg
        BundleCfg['windows'] = WindowsCfg
        Data['bundle'] = BundleCfg
        
        WriteJson(TauriConf, Data)
        ConsoleInstance.print("[bold green]✓ 配置已实时保存到 tauri.conf.json！[/bold green]")
        time.sleep(0.5)

def HandleDistribution():
    Data = ReadJson(TauriConf)
    
    ConsoleInstance.print("\n[bold white]--- Tauri 生产包构建配置审核 ---[/bold white]")
    TableInstance = Table(show_header=False, box=None)
    TableInstance.add_column("配置项 (Key)", style="dim")
    TableInstance.add_column("当前值 (Value)", style="bold white")
    TableInstance.add_column("配置说明 (Description)", style="cyan")
    
    TableInstance.add_row("应用名称 (productName):", Data.get('productName', '未设置'), "安装包显示的软件名称")
    TableInstance.add_row("应用标识 (identifier):", Data.get('identifier', '未设置'), "软件唯一包名")
    TableInstance.add_row("当前版本 (version):", Data.get('version', '未设置'), "打包输出的版本号")
    
    WindowsCfg = Data.get('bundle', {}).get('windows', {})
    NsisCfg = WindowsCfg.get('nsis', {})
    ConsoleInstance.print(TableInstance)
    
    ConsoleInstance.print("\n[bold white]--- Windows 安装包高级配置 ---[/bold white]")
    NsisTable = Table(show_header=False, box=None)
    NsisTable.add_column("配置项 (Key)", style="dim")
    NsisTable.add_column("当前值 (Value)", style="bold yellow")
    NsisTable.add_column("配置说明 (Description)", style="cyan")

    NsisTable.add_row("安装模式 (installMode):", str(NsisCfg.get('installMode', '未设置')), "perMachine=所有用户, currentUser=当前用户")
    NsisTable.add_row("显示语言选择器 (displayLanguageSelector):", str(NsisCfg.get('displayLanguageSelector', '未设置')), "安装时是否弹出语言选择框")
    NsisTable.add_row("升级标识码 (upgradeCode):", str(WindowsCfg.get('upgradeCode', '未设置')), "GUID，标识该软件用于替换旧版本")
    
    ConsoleInstance.print(NsisTable)
    
    ConsoleInstance.print("\n[bold red]注意：打包流程将调用 Rust 编译器进行全量构建，耗时较长。[/bold red]")
    if not Confirm.ask("确认使用上述配置进行打包吗？"):
        ConsoleInstance.print("[dim]已取消打包流程。[/dim]")
        return
        
    ConsoleInstance.print("\n[bold blue]开始执行 Tauri 生产构建流水线... (可能会花费几分钟，请勿关闭终端)[/bold blue]")
    RunCommand("npm run tauri:build", "执行 Tauri 构建 (Cargo Release)")
    ConsoleInstance.print("[bold green]✓ 构建成功！安装包已输出至 src-tauri/target/release/bundle 目录。[/bold green]")
    input("\n按回车键返回主菜单...")

def Main():
    while True:
        ShowMenu()
        Choice = Prompt.ask("请选择操作编号", choices=["0", "1", "2", "3", "4", "5", "6", "7", "8"], default="1")
        
        if Choice == "1":
            ConsoleInstance.print("\n[bold blue]:: 启动 Tauri 开发服务器... (Ctrl+C 中止) ::[/bold blue]")
            try:
                subprocess.run("npm run tauri:dev", shell=True)
            except KeyboardInterrupt:
                ConsoleInstance.print("\n[dim]已终止进程。[/dim]")
            time.sleep(1)
            
        elif Choice == "2":
            RunCommand("npm install", "安装项目前端依赖")
            time.sleep(1)
            
        elif Choice == "3":
            ConsoleInstance.print("\n[bold blue]:: 清理工作区 ::[/bold blue]")
            if os.path.exists("Dist"):
                subprocess.run("rmdir /s /q Dist", shell=True)
                ConsoleInstance.print("[dim]清理前端 Dist 目录...[/dim]")
            if os.path.exists("src-tauri/target"):
                subprocess.run("rmdir /s /q src-tauri\\target", shell=True)
                ConsoleInstance.print("[dim]清理 Rust target 目录...[/dim]")
            ConsoleInstance.print("[bold green]✓ 清理完成[/bold green]")
            time.sleep(1)
            
        elif Choice == "4":
            UpdateVersions()
            
        elif Choice == "5":
            RunCommand("npm run build", "编译前端静态资源")
            time.sleep(1)
            
        elif Choice == "6":
            HandleDistribution()
            
        elif Choice == "7":
            EditBuildConfig()

        elif Choice == "8":
            CheckAndInstallEnvironment()
            
        elif Choice == "0":
            ConsoleInstance.print("\n[dim]进程已结束。[/dim]\n")
            break

if __name__ == "__main__":
    try:
        if not os.path.exists(TauriConf):
            ConsoleInstance.print(f"[bold red]错误：找不到 {TauriConf}，请确保在项目根目录运行！[/bold red]")
            sys.exit(1)
        Main()
    except Exception as Err:
        ConsoleInstance.print(f"\n[bold red]发生意外错误: {Err}[/bold red]")
    finally:
        os.system("pause")
