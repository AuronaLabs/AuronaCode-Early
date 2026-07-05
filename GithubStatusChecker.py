# -*- coding: utf-8 -*-
"""
GitHub 状态检查器
用于检查 GitHub 服务可用性以及本地 Git 仓库的同步状态。
"""

import os
import sys
import subprocess
import urllib.request
import json
from rich.console import Console
from rich.panel import Panel
from rich.table import Table
from rich.text import Text

# 在 Windows 平台下强制设置输出编码为 UTF-8，以防止中文和特殊字符输出乱码
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

ConsoleInstance = Console()

class GithubStatusChecker:
    """GitHub 状态检查类"""

    def __init__(self):
        self.RepoPath = os.getcwd()
        self.HasGit = self.CheckGitInstalled()

    def CheckGitInstalled(self):
        """检查系统是否安装了 Git"""
        try:
            subprocess.run(["git", "--version"], capture_output=True, check=True)
            return True
        except Exception:
            return False

    def CheckGitHubServiceStatus(self):
        """检查 GitHub 官方服务的实时状态"""
        ApiUrl = "https://www.githubstatus.com/api/v2/summary.json"
        try:
            # 设置较短的超时，避免长时间挂起
            Request = urllib.request.Request(
                ApiUrl, 
                headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
            )
            with urllib.request.urlopen(Request, timeout=5) as Response:
                Data = json.loads(Response.read().decode('utf-8'))
                
            StatusIndicator = Data.get("status", {}).get("indicator", "none")
            StatusDescription = Data.get("status", {}).get("description", "所有系统正常运行")
            
            # 组件状态
            Components = Data.get("components", [])
            MajorComponents = []
            ForName = ["Git Operations", "API Requests", "Webhooks", "Issues", "Pull Requests", "GitHub Actions"]
            for Comp in Components:
                if Comp.get("name") in ForName:
                    MajorComponents.append(Comp)
                        
            return {
                "Success": True,
                "Indicator": StatusIndicator,
                "Description": StatusDescription,
                "Components": MajorComponents
            }
        except Exception as Err:
            return {
                "Success": False,
                "Error": str(Err)
            }

    def CheckGitRepositoryStatus(self):
        """检查本地 Git 仓库的状态与远程同步情况"""
        if not self.HasGit:
            return {"Success": False, "Error": "系统未安装 Git 命令行工具"}

        # 检查当前目录是否为 Git 仓库
        if not os.path.exists(os.path.join(self.RepoPath, ".git")):
            return {"Success": False, "Error": "当前工作区不是一个有效的 Git 仓库"}

        try:
            # 1. 获取当前分支名
            BranchResult = subprocess.run(
                ["git", "rev-parse", "--abbrev-ref", "HEAD"], 
                capture_output=True, text=True, check=True
            )
            CurrentBranch = BranchResult.stdout.strip()

            # 2. 检查是否有未提交的代码修改
            StatusResult = subprocess.run(
                ["git", "status", "--porcelain"], 
                capture_output=True, text=True, check=True
            )
            UncommittedChanges = StatusResult.stdout.strip().split("\n")
            UncommittedCount = len([Line for Line in UncommittedChanges if Line])

            # 3. 尝试拉取远程更新信息 (git fetch)
            # 限制超时，防止无网络时卡死
            FetchSuccess = True
            try:
                subprocess.run(["git", "fetch"], capture_output=True, check=True, timeout=10)
            except Exception:
                FetchSuccess = False

            # 4. 获取本地分支领先/落后远程分支的提交数
            AheadCount = 0
            BehindCount = 0
            HasTrackingBranch = False
            TrackingBranch = ""

            # 获取对应的远程跟踪分支
            TrackingResult = subprocess.run(
                ["git", "rev-parse", "--abbrev-ref", "@{u}"],
                capture_output=True, text=True
            )
            if TrackingResult.returncode == 0:
                HasTrackingBranch = True
                TrackingBranch = TrackingResult.stdout.strip()
                
                # 检查领先/落后数量
                CompareResult = subprocess.run(
                    ["git", "rev-list", "--left-right", "--count", f"HEAD...{TrackingBranch}"],
                    capture_output=True, text=True, check=True
                )
                Counts = CompareResult.stdout.strip().split()
                if len(Counts) == 2:
                    AheadCount = int(Counts[0])
                    BehindCount = int(Counts[1])

            return {
                "Success": True,
                "CurrentBranch": CurrentBranch,
                "UncommittedCount": UncommittedCount,
                "FetchSuccess": FetchSuccess,
                "HasTrackingBranch": HasTrackingBranch,
                "TrackingBranch": TrackingBranch,
                "AheadCount": AheadCount,
                "BehindCount": BehindCount
            }
        except Exception as Err:
            return {"Success": False, "Error": str(Err)}

    def PrintStatusReport(self):
        """输出美化的状态报告面板"""
        ConsoleInstance.print("\n[bold cyan]● 正在执行 GitHub 状态自动检查工作流...[/bold cyan]")
        
        # 1. 检查 GitHub 官方服务状态
        ServiceStatus = self.CheckGitHubServiceStatus()
        
        # 2. 检查 Git 仓库状态
        RepoStatus = self.CheckGitRepositoryStatus()
        
        # 构建 GitHub 官方状态面板
        if ServiceStatus["Success"]:
            Indicator = ServiceStatus["Indicator"]
            Desc = ServiceStatus["Description"]
            
            if Indicator == "none":
                Color = "green"
                TitleIcon = "🟢"
            elif Indicator == "minor":
                Color = "yellow"
                TitleIcon = "🟡"
            else:
                Color = "red"
                TitleIcon = "🔴"
                
            ServiceText = Text()
            ServiceText.append(f"{TitleIcon} GitHub 官方服务状态: ", style="bold")
            ServiceText.append(f"{Desc}\n", style=Color)
            
            # 组件详细状态表
            CompTable = Table(show_header=True, header_style="bold magenta", box=None, padding=(0, 2))
            CompTable.add_column("服务组件", style="cyan")
            CompTable.add_column("实时状态", style="bold")
            
            for Comp in ServiceStatus["Components"]:
                CompName = Comp.get("name")
                CompStatus = Comp.get("status")
                
                # 状态美化
                StatusStyle = "green"
                StatusLabel = "正常运行"
                if CompStatus == "operational":
                    StatusStyle = "green"
                    StatusLabel = "正常 (Operational)"
                elif CompStatus == "degraded_performance":
                    StatusStyle = "yellow"
                    StatusLabel = "性能降级 (Degraded)"
                elif CompStatus == "partial_outage":
                    StatusStyle = "yellow"
                    StatusLabel = "部分中断 (Partial Outage)"
                elif CompStatus == "major_outage":
                    StatusStyle = "red"
                    StatusLabel = "严重中断 (Major Outage)"
                    
                CompTable.add_row(CompName, Text(StatusLabel, style=StatusStyle))
                
            ConsoleInstance.print(Panel(
                CompTable, 
                title=f"[bold {Color}]GitHub 官方服务状态监测[/bold {Color}]", 
                border_style=Color,
                padding=(1, 2)
            ))
        else:
            ConsoleInstance.print(Panel(
                f"❌ 无法连接至 GitHub 官方状态服务器，可能是网络连接问题。\n错误信息: {ServiceStatus['Error']}",
                title="[bold red]GitHub 服务状态 (连接失败)[/bold red]",
                border_style="red"
            ))

        # 构建本地仓库状态面板
        if RepoStatus["Success"]:
            RepoTable = Table(show_header=False, box=None, padding=(0, 2))
            RepoTable.add_column("Key", style="dim cyan")
            RepoTable.add_column("Val", style="bold white")
            
            RepoTable.add_row("当前本地分支:", RepoStatus["CurrentBranch"])
            
            # 未提交的文件
            UncommittedStr = "干净 (无未提交的更改)"
            UncommittedColor = "green"
            if RepoStatus["UncommittedCount"] > 0:
                UncommittedStr = f"有 {RepoStatus['UncommittedCount']} 个未提交的更改"
                UncommittedColor = "yellow"
            RepoTable.add_row("本地代码更改:", Text(UncommittedStr, style=UncommittedColor))
            
            # 同步状态
            if RepoStatus["HasTrackingBranch"]:
                RepoTable.add_row("远程跟踪分支:", RepoStatus["TrackingBranch"])
                
                SyncStatusStr = ""
                SyncColor = "green"
                if RepoStatus["AheadCount"] == 0 and RepoStatus["BehindCount"] == 0:
                    SyncStatusStr = "已与远程分支同步"
                else:
                    Parts = []
                    if RepoStatus["AheadCount"] > 0:
                        Parts.append(f"领先远程 {RepoStatus['AheadCount']} 个提交 (需 Push)")
                        SyncColor = "yellow"
                    if RepoStatus["BehindCount"] > 0:
                        Parts.append(f"落后远程 {RepoStatus['BehindCount']} 个提交 (需 Pull)")
                        SyncColor = "orange3"
                    SyncStatusStr = " | ".join(Parts)
                RepoTable.add_row("分支同步状态:", Text(SyncStatusStr, style=SyncColor))
            else:
                RepoTable.add_row("远程跟踪分支:", Text("未关联远程分支 (没有 upstream)", style="red"))
                
            if not RepoStatus["FetchSuccess"]:
                RepoTable.add_row("温馨提示:", Text("注意：无法执行 `git fetch`，显示的分支同步状态可能为缓存数据", style="yellow"))

            ConsoleInstance.print(Panel(
                RepoTable,
                title="[bold green]本地 Git 仓库同步状态[/bold green]",
                border_style="green",
                padding=(1, 2)
            ))
        else:
            ConsoleInstance.print(Panel(
                f"❌ 无法检查本地 Git 仓库状态。\n原因: {RepoStatus['Error']}",
                title="[bold red]本地 Git 仓库状态 (检查失败)[/bold red]",
                border_style="red"
            ))

if __name__ == "__main__":
    Checker = GithubStatusChecker()
    Checker.PrintStatusReport()
