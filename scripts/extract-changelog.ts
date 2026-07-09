import { CHANGELOG_DATA } from "../Src/Features/Settings/ChangelogData";
import fs from "fs";
import path from "path";

const tag = process.env.GITHUB_REF_NAME || "v0.0.0";
const version = tag.toLowerCase().replace('v', '');

const entry = CHANGELOG_DATA.find(e => e.version.toLowerCase().replace('v', '') === version);

let body = `🚀 **Aurona Code ${tag} 发布！**\n\n`;

if (!entry) {
  console.log(`[Warning] No changelog found for version ${tag}.`);
  body += `完整的更新日志请前往主程序的 **[设置] -> [更新历史]** 面板查看，或查阅源码中的 \`ChangelogData.ts\`。\n`;
} else {
  if (entry.summary) {
    body += `${entry.summary}\n\n`;
  }
  
  entry.sections.forEach(sec => {
    body += `### ${sec.title}\n`;
    if (sec.description) body += `${sec.description}\n`;
    if (sec.items) {
      sec.items.forEach(item => {
        body += `- ${item}\n`;
      });
    }
    body += '\n';
  });
}

body += `
---

### 系统要求与下载指引

本版本为全平台提供自动化构建产物，请从下方 **Assets** 列表中选择适合您系统的安装包：

* **Windows 客户端**：请下载 \`.msi\` 或 \`.exe\` 文件（仅支持 Windows 10/11，不支持 Windows 7）
* **macOS 客户端**：请下载 \`.dmg\` 或 \`.app.tar.gz\` 文件
* **Linux 客户端**：请下载 \`.AppImage\` 或 \`.deb\` 文件

> **提示**：Aurona Code 持续致力于提供极速、安全的轻量化开发体验。如果您在当前版本遇到问题，欢迎前往 Issues 提交反馈。
`;

fs.writeFileSync(path.join(process.cwd(), 'RELEASE_BODY.md'), body, 'utf-8');
console.log("[Success] Extracted changelog to RELEASE_BODY.md");

if (process.env.GITHUB_ENV) {
  const delimiter = "EOF_AURONA_RELEASE";
  fs.appendFileSync(process.env.GITHUB_ENV, `RELEASE_BODY<<${delimiter}\n${body}\n${delimiter}\n`);
  console.log("[Success] Wrote RELEASE_BODY to GITHUB_ENV");
}
