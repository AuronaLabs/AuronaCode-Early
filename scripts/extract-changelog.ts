import fs from "fs";
import path from "path";
import { CHANGELOG_DATA } from "../Src/Features/Settings/ChangelogData";

const tag = process.env.GITHUB_REF_NAME || "v0.0.0";
const version = tag.toLowerCase().replace("v", "");

const entry = CHANGELOG_DATA.find((e) => e.version.toLowerCase().replace("v", "") === version);

let body = ``;

if (!entry) {
  console.log(`[Warning] No changelog found for version ${tag}.`);
  body += `完整的更新日志请前往主程序的 **[设置] -> [更新历史]** 面板查看，或查阅源码中的 \`ChangelogData.ts\`。\n`;
} else {
  if (entry.summary) {
    body += `${entry.summary}\n\n`;
  }

  entry.sections.forEach((sec) => {
    body += `### ${sec.title}\n`;
    if (sec.description) body += `${sec.description}\n`;
    if (sec.items) {
      sec.items.forEach((item) => {
        body += `- ${item}\n`;
      });
    }
    body += "\n";
  });
}

body += `
---

### 下载与反馈

请在下方 **Assets** 列表中选择对应平台的安装包：

- **Windows**：下载 \`.exe\` 安装程序。
- **macOS**：下载 \`.dmg\` 安装包或 \`.app.tar.gz\` 更新归档。
- **Linux**：下载 \`.AppImage\` 或 \`.deb\` 安装包。

遇到问题时，请通过项目 Issues 提交版本号、操作系统和复现步骤。分享日志前，请移除令牌、密码及其他敏感信息。
`;

fs.writeFileSync(path.join(process.cwd(), "RELEASE_BODY.md"), body, "utf-8");
console.log("[Success] Extracted changelog to RELEASE_BODY.md");

if (process.env.GITHUB_ENV) {
  const delimiter = "EOF_AURONA_RELEASE";
  fs.appendFileSync(process.env.GITHUB_ENV, `RELEASE_BODY<<${delimiter}\n${body}\n${delimiter}\n`);
  console.log("[Success] Wrote RELEASE_BODY to GITHUB_ENV");
}
