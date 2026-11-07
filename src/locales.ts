/** Installer UI copy; payment remains in the independent anticli Skill. */
export const zh = {
  title: "安装资源",
  cancel: "取消",
  close: "关闭",
  confirm: "确认安装",
  loading: "正在读取安装信息…",
  installing: "正在安装…",
  source: "安装来源",
  archive: "下载地址",
  version: "版本",
  target: "安装位置",
  installed: "安装完成",
  restart: "安装完成，请重启 Harness 以生效。",
  error: "无法完成安装",
  checksum: "SHA256",
  "invalid-message": "安装信息无效或已超过十分钟，请回到资源页面重新复制。",
  expired: "安装信息已过期，请重新复制。",
  "untrusted-source": "来源未在安装器允许列表中，请检查插件配置。",
  "invalid-plan": "安装计划与复制的信息不一致，请重新复制。",
  "unsupported-plugin":
    "此入口目前支持 DSH bundle 插件；MCP 和 Agent Plugin 请使用对应客户端的安装方式。",
  "paid-resource": "付费资源请在会话中通过 anticli 获取。",
  "plan-failed": "读取安装计划失败。",
  "download-failed": "下载资源包失败。",
  "client-connection":
    "与 Harness 安装器的连接失败，请检查插件是否已启用；若安装中发生重启，请先在插件列表确认结果。",
  "request-timeout": "请求超时",
  "request-tls": "TLS 证书验证失败",
  integrity: "文件摘要校验失败，安装已停止。",
  "unsafe-archive": "压缩包包含不支持或不安全的文件路径或链接。",
  "archive-limit": "资源大小或文件数量超过安装器限制。",
  "invalid-skill": "没有找到有效的 SKILL.md，或技能名称重复。",
  "unsafe-target": "技能安装目录不是普通目录，请检查配置。",
  "already-installed": "资源已存在，安装器不会覆盖已有资源。",
  "native-install": "Harness 原生插件安装未完成，请在插件管理页面检查详情。",
  busy: "安装器正在处理其他任务，请稍后重试。",
  unloading: "安装器正在关闭，请重新打开客户端。",
  "operation-failed": "操作未完成，请检查网络、文件权限及资源格式后重试。",
};
export type Key = keyof typeof zh;
export const en: Record<Key, string> = {
  title: "Install resource",
  cancel: "Cancel",
  close: "Close",
  confirm: "Install",
  loading: "Reading installation information…",
  installing: "Installing…",
  source: "Source",
  archive: "Download",
  version: "Version",
  target: "Destination",
  installed: "Installation complete",
  restart: "Installation complete. Restart Harness to apply the change.",
  error: "Installation could not complete",
  checksum: "SHA256",
  "invalid-message":
    "Invalid or expired installation information. Copy it again from the resource page.",
  expired: "Installation information expired. Copy it again.",
  "untrusted-source":
    "The origin is not allowed by the installer configuration.",
  "invalid-plan":
    "The installation plan does not match the copied information.",
  "unsupported-plugin":
    "This entry supports DSH bundles. Use a compatible installer for MCP servers and Agent Plugins.",
  "paid-resource": "Use anticli in a conversation to acquire a paid resource.",
  "plan-failed": "Could not read the installation plan.",
  "download-failed": "Could not download the resource archive.",
  "client-connection":
    "The Harness installer connection failed. Check that the plugin is enabled. If Harness restarted during installation, check the plugin list before retrying.",
  "request-timeout": "Request timed out",
  "request-tls": "TLS certificate verification failed",
  integrity: "File integrity verification failed. Installation stopped.",
  "unsafe-archive": "The archive contains unsupported paths or links.",
  "archive-limit": "The archive exceeds a configured size or file count limit.",
  "invalid-skill":
    "No valid SKILL.md was found, or skill names are duplicated.",
  "unsafe-target": "The skill destination is not a regular directory.",
  "already-installed":
    "The resource already exists. Existing resources are never replaced.",
  "native-install":
    "The native plugin installation did not complete. Check Harness plugin management.",
  busy: "Another installation is running.",
  unloading: "The installer is closing. Reopen the client.",
  "operation-failed":
    "Operation failed. Check the network, file permissions and resource format.",
};
