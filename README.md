# dsh-installer

AntiStudio 的 Harness 网页安装器，用于在本机 DeepSeek Harness 中确认并安装免费的 Skill 和 DSH 插件。

公开发行包：**0.1.6**。托管在 [AntiStudio npm 仓库](https://registry.antistudio.cn/dsh-installer)，支持匿名读取和下载，安装时保留客户端现有的 npm 源配置即可。

## 安装插件

推荐将下面的提示词复制到**目标 Harness 客户端的会话**中：

```text
请用当前 Harness 的插件管理器安装并启用：
https://registry.antistudio.cn/dsh-installer/-/dsh-installer-0.1.6.tgz
完成后提醒我重启客户端。
```

也可以在该客户端的“插件 → 添加插件”中粘贴上述安装包地址。使用 CLI 时：

```sh
dsh plugin --profile desktop add https://registry.antistudio.cn/dsh-installer/-/dsh-installer-0.1.6.tgz --save-exact
```

Windows 官方客户端的 CLI 通常位于 `%LOCALAPPDATA%\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd`。若 `dsh` 不在 PATH 中，用这个完整路径执行命令。

**安装或升级后，完全退出 Harness（包括托盘进程），再重新打开。** 前端与 Host 都需要加载对应版本；插件列表显示新版本不代表正在运行的 Host 已更新，单独刷新页面也不能代替重启。

官方客户端与源码运行的客户端使用不同 profile。网页唤起官方客户端时，插件应安装在官方客户端的 desktop profile 中。

## 从网页安装资源

1. 在 AntiStudio 免费资源详情页点击“安装到本地 Agent”，选择 DeepSeek Harness。
2. 点击“打开客户端”。网页先复制一条 `dsh://install?...` 安装消息，复制成功后通过官方 `dsh://open` 唤起 Harness。
3. 插件在启动、聚焦、恢复可见或 Host 连接就绪时检查剪贴板。识别有效消息后，**立即清空本次消息**，再读取安装计划并弹出确认框。
4. 确认后才下载和安装。取消、读取失败或安装失败后，需要回到 Web 重新点击；反复聚焦客户端不会再次触发原消息。

`dsh://install` 是剪贴板中的安装消息标识；`dsh://open` 是系统唤起入口。当前网页流程不注册或接管系统的 `dsh` 协议，也不修改 Harness 源码。

清空前会再次检查剪贴板是否仍是本次消息。后来复制的其他内容、普通文本和无效链接不会被清除。剪贴板读取只在本机 Desktop 连接中启用；普通浏览器会话和远程连接不会消费本机安装消息。网页复制失败时会提示权限问题，并停止唤起。

## 支持范围

- **Skill**：ZIP / TGZ，按安装计划选择 SKILL.md，完整保留对应目录下的脚本和资源，安装到 `$DSH_HOME/skills`。已有目录不覆盖。
- **DSH 插件**：带 `dsh.bundle` 声明的源码 ZIP 或 npm TGZ，验证后交给 Harness 原生插件管理器，依赖安装、构建授权、激活和重启遵循宿主政策。
- **MCP / Agent Plugin**：使用对应客户端提供的安装机制。
- **付费资源**：通过独立的 anticli CLI / Skill 获取和安装。

声明兼容 DSH `>=0.2.0-0 <0.3.0-0`，包括 0.2.x 的 alpha / rc 版本；宿主 Node.js 运行时要求 `^22.19.0 || >=24`。开发 SDK 固定在 `0.2.1-rc.5`，用于可复现构建。

## Web 接入与消息格式

`GET /api/catalog/resources/:id/installer` 返回固定版本的 `client_url`，其格式为：

```text
dsh://install?source=<URL编码后的安装计划地址>
```

`source` 必须指向 `/api/catalog/resources/<32位资源ID>/install?version=<固定版本>`。网页每次点击都附加新的 nonce 和 Unix 秒时间戳，然后复制并唤起：

```js
const link = new URL(result.client_url);
link.searchParams.set("nonce", crypto.randomUUID());
link.searchParams.set("ts", String(Math.floor(Date.now() / 1000)));
await navigator.clipboard.writeText(link.href);
window.location.href = "dsh://open";
```

实际 Web 接入还应校验链接、处理剪贴板权限错误。nonce 用于区分每次点击；ts 使用秒而非毫秒，带时间戳的消息超过十分钟或领先本机时间超过一分钟时会被拒绝。插件也支持仅含 source 的手动安装链接。

URI 只表达安装意图。Host 会校验允许来源、资源 ID、固定版本、免费价格与下载地址；确认前只读取安装计划。来源提供 SHA256 / npm SRI 时会校验摘要，压缩包另检查路径穿越、链接、重复路径和解压限制。

## 配置

默认允许 `https://antistudio.cn`、`https://www.antistudio.cn`，以及预设的 GitHub / npm 下载域名。自建服务可在 profile 的 `cordis.patch.yml` 中配置：

```yaml
- id: dsh-installer
  config:
    origins:
      - https://antistudio.cn
      - https://www.antistudio.cn
      - http://127.0.0.1:18082
    timeoutMs: 120000
    maxArchiveBytes: 67108864
    maxExpandedBytes: 134217728
    maxFileBytes: 16777216
    maxFiles: 10000
```

只接受完整 HTTPS origin，HTTP 仅用于明确配置的回环地址。`downloadHosts` 可覆盖允许的 HTTPS 下载域名列表，每次重定向都会重新校验。`dshHome` 应与目标客户端一致；未设置 DSH_HOME 时，默认用户数据目录为 `~/.dsh`。

请求优先使用 HTTP_PROXY / HTTPS_PROXY / NO_PROXY；Windows 未设置环境代理时读取系统手动 HTTP / HTTPS 代理，不修改全局网络设置。PAC / SOCKS 代理需提供可用的 HTTP 代理入口。

临时文件会清理，插件源包保留在 `$DSH_HOME/installer/packages/`，避免 profile 引用的本地依赖失效。浏览器 Cookie、账号 token 和普通剪贴板文本不会发送给资源来源。

## 常见问题

| 现象                       | 检查方式                                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 只唤起客户端，没有安装确认 | 确认安装器已在实际被唤起的客户端中启用，并使用支持“先复制、再唤起”的新版 Web。安装后完全退出并重开客户端。          |
| 刚复制就提示无效或已过期   | 从 Web 重新点击生成新消息；检查 ts 是否为秒。升级过插件时，先完全重启客户端，确保 Host 加载了新的链接解析代码。     |
| 取消后再聚焦没有弹窗       | 安装消息在识别时已清空，这是预期行为；重新从 Web 点击安装。                                                         |
| 下载失败                   | 根据提示中的主机、HTTP 状态、超时或 TLS 信息检查网络与代理。GitHub zipball 下载已使用 `Accept: */*` 避免 HTTP 415。 |
| 提示资源已存在             | 安装器会保护已有技能目录；先核对本地内容，再决定如何处理冲突。                                                      |

## 开发与验证

```sh
npm ci
npm run build
npm test
npm pack
```

测试覆盖消息识别与过期、立即清空、后续复制保护、取消后重新点击、启动与聚焦、Host 就绪、免费 Skill / Plugin 安装，以及来源、版本、网络和压缩包校验。

已验证 Windows 官方客户端通过 `dsh://open` 唤起后消费安装消息并清空剪贴板，以及使用空凭据配置通过官方 Harness CLI 下载、安装公开发行包。
