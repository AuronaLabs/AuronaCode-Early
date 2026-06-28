# -*- coding: utf-8 -*-
"""
GithubStatusChecker.py
用于自动检查 AuronaCode-Early 仓库的 GitHub 状态的 Python 脚本。
支持获取并以 Rich 格式化面板展示最新的 Issues 和 Pull Requests。
"""

import urllib.request
import json
import os
import sys

def InstallAndImport(PackageName):
    """
    动态检测并安装 Python 库，确保 Rich 库可用。
    """
    try:
        return __import__(PackageName)
    except ImportError:
        import subprocess
        subprocess.check_call([sys.executable, "-m", "pip", "install", PackageName, "-q"])
        return __import__(PackageName)

RichModule = InstallAndImport("rich")
from rich.console import Console
from rich.table import Table
from rich.panel import Panel

class GithubStatusChecker:
    """
    GitHub 状态检查器类，用于抓取并展示仓库的最新的 Issues 与 Pull Requests。
    """
    def __init__(self):
        self.ConsoleInstance = Console()
        self.ApiUrl = "https://api.github.com/repos/AuronaLabs/AuronaCode-Early/issues?state=open&per_page=30"
        # API 请求必须包含 User-Agent 头，否则 GitHub 会拦截
        self.RequestHeaders = {
            "User-Agent": "AuronaCode-StatusChecker-Agent/1.0"
        }

    def FetchIssuesAndPRs(self):
        """
        发起 HTTP 请求获取 GitHub 数据并返回解析后的 JSON 列表。
        """
        RequestInstance = urllib.request.Request(url=self.ApiUrl, headers=self.RequestHeaders)
        try:
            with urllib.request.urlopen(RequestInstance, timeout=10) as Response:
                if Response.status == 200:
                    ResponseData = Response.read().decode("utf-8")
                    return json.loads(ResponseData)
        except Exception as ErrorException:
            self.ConsoleInstance.print(f"[bold red]获取 GitHub 状态失败: {ErrorException}[/bold red]")
            return None

    def ParseAndDisplay(self):
        """
        解析返回的 Issues 列表，过滤并区分 Issues 与 PR，然后使用 Table 展示。
        """
        self.ConsoleInstance.print("[bold blue]正在从 GitHub 抓取最新状态...[/bold blue]\n")
        RawDataList = self.FetchIssuesAndPRs()
        
        if not RawDataList:
            return

        IssueTable = Table(show_header=True, header_style="bold magenta", title="GitHub 开放议题 (Open Issues)")
        IssueTable.add_column("编号", style="dim", width=8)
        IssueTable.add_column("标题", style="bold white")
        IssueTable.add_column("创建者", style="cyan")
        IssueTable.add_column("创建时间", style="green")

        PrTable = Table(show_header=True, header_style="bold green", title="GitHub 开放合并请求 (Open Pull Requests)")
        PrTable.add_column("编号", style="dim", width=8)
        PrTable.add_column("标题", style="bold white")
        PrTable.add_column("创建者", style="cyan")
        PrTable.add_column("创建时间", style="green")

        HasIssue = False
        HasPr = False

        for ItemData in RawDataList:
            ItemNumber = f"#{ItemData.get('number')}"
            ItemTitle = ItemData.get("title", "")
            ItemUser = ItemData.get("user", {}).get("login", "未知")
            ItemCreatedAt = ItemData.get("created_at", "")[:10]  # 只保留日期部分

            # 如果存在 pull_request 属性，则判定为 PR
            if "pull_request" in ItemData:
                PrTable.add_row(ItemNumber, ItemTitle, ItemUser, ItemCreatedAt)
                HasPr = True
            else:
                IssueTable.add_row(ItemNumber, ItemTitle, ItemUser, ItemCreatedAt)
                HasIssue = True

        if HasIssue:
            self.ConsoleInstance.print(IssueTable)
            self.ConsoleInstance.print("\n")
        else:
            self.ConsoleInstance.print("[yellow]当前没有开放的 Issues。[/yellow]\n")

        if HasPr:
            self.ConsoleInstance.print(PrTable)
            self.ConsoleInstance.print("\n")
        else:
            self.ConsoleInstance.print("[yellow]当前没有开放的 Pull Requests。[/yellow]\n")

def RunStatusChecker():
    """
    脚本执行的主入口函数。
    """
    CheckerInstance = GithubStatusChecker()
    CheckerInstance.ParseAndDisplay()

if __name__ == "__main__":
    RunStatusChecker()
