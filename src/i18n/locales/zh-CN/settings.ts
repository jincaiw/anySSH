// ─── settings (zh-CN) ───────────────────────────────────────────────────────
//
// Settings page: every section, label and description.
//
// Keys are written WITHOUT the `settings.` prefix — the locale index adds it.
// Must mirror ../en-US/settings.ts key-for-key (src/i18n/__tests__/i18n-parity.test.ts).

export default {
  // ─── Page chrome ─────────────────────────────────────────────────────────
  title: "设置",
  "sections.ariaLabel": "设置分区",

  "sections.appearance": "外观",
  "sections.terminal": "终端",
  "sections.explorer": "文件浏览",
  "sections.transfers": "传输",
  "sections.editors": "编辑器",
  "sections.data": "数据",
  "sections.about": "关于与更新",

  "sections.appearance.description": "主题与界面外观。",
  "sections.terminal.description": "字体、光标与回滚历史。",
  "sections.explorer.description": "文件浏览器的行为方式。",
  "sections.transfers.description": "控制文件传输的方式。",
  "sections.editors.description": "文件浏览器中「编辑」/「打开方式」使用的编辑器。",
  "sections.data.description": "备份、恢复与重置你的数据。",
  "sections.about.description": "应用信息、相关链接与更新。",

  // ─── Appearance ──────────────────────────────────────────────────────────
  "appearance.language": "语言",
  "appearance.languageHint": "选择界面显示语言。",

  "appearance.group.theme": "主题",
  "appearance.colorTheme": "配色主题",
  "appearance.colorThemeHint": "在深色与更柔和的浅灰界面之间切换",
  "appearance.theme.dark": "深色",
  "appearance.theme.light": "浅色",

  "appearance.accentColor": "强调色",
  "appearance.accentColorHint": "用于按钮、链接与选中状态",
  "appearance.accent.blue": "蓝",
  "appearance.accent.indigo": "靛蓝",
  "appearance.accent.violet": "紫罗兰",
  "appearance.accent.pink": "粉",
  "appearance.accent.red": "红",
  "appearance.accent.orange": "橙",
  "appearance.accent.green": "绿",
  "appearance.accent.teal": "青",
  "appearance.accent.custom": "自定义",
  "appearance.accent.customColor": "自定义颜色",
  "appearance.accent.customDialog": "自定义强调色",
  "appearance.accent.hue": "强调色色相",
  "appearance.accent.lightness": "亮度",
  "appearance.accent.saturation": "饱和度",

  "appearance.group.interface": "界面",
  "appearance.interfaceFont": "界面字体",
  "appearance.interfaceFontHint": "菜单、标签与面板使用的字体",
  "appearance.interfaceMonoFont": "界面等宽字体",
  "appearance.interfaceMonoFontHint": "路径、权限与代码使用的字体（不含终端）",

  // ─── Font picker options ─────────────────────────────────────────────────
  "fonts.geistDefault": "Geist（默认）",
  "fonts.systemUI": "系统界面字体",
  "fonts.jetbrainsMonoDefault": "JetBrains Mono（默认）",
  "fonts.jetbrainsNerdFont": "JetBrains Nerd Font（图标）",
  "fonts.systemMonospace": "系统等宽字体",
  "fonts.current": "当前字体",

  // ─── Terminal ────────────────────────────────────────────────────────────
  "terminal.group.font": "字体",
  "terminal.fontFamily": "字体系列",
  "terminal.fontFamilyHint": "终端使用的等宽字体",
  "terminal.fontSize": "字号",
  "terminal.fontSizeHint": "以像素为单位（8–42）",
  "terminal.lineHeight": "行高",
  "terminal.lineHeightHint": "行与行之间的间距（1.0–2.0）",

  "terminal.group.cursor": "光标",
  "terminal.cursorStyle": "光标样式",
  "terminal.cursorStyleHint": "终端光标的形状",
  "terminal.cursor.bar": "竖线",
  "terminal.cursor.block": "方块",
  "terminal.cursor.underline": "下划线",
  "terminal.cursorBlink": "光标闪烁",
  "terminal.cursorBlinkHint": "让光标动态闪烁",

  "terminal.group.clipboard": "剪贴板",
  "terminal.copyOnSelect": "选中即复制",
  "terminal.copyOnSelectHint": "自动将选中的文本复制到剪贴板",
  "terminal.pasteButton": "粘贴按键",
  "terminal.pasteButtonHint": "用于把剪贴板内容粘贴到终端的鼠标按键",
  "terminal.paste.off": "关闭",
  "terminal.paste.right": "右键",
  "terminal.paste.middle": "中键",

  "terminal.group.history": "历史",
  "terminal.scrollback": "回滚缓冲区",
  "terminal.scrollbackHint": "历史中保留的行数（500–100,000）",
  "terminal.applyHint": "更改会立即应用到已打开的终端。",

  // ─── Explorer ────────────────────────────────────────────────────────────
  "explorer.doubleClick": "双击文件",
  "explorer.doubleClickHint": "在浏览器中双击文件时的行为",
  "explorer.doubleClick.openInEditor": "在编辑器中打开",
  "explorer.fallbackHint": "若未配置编辑器，则回退为下载（见「编辑器」）。",

  // ─── Transfers ───────────────────────────────────────────────────────────
  "transfers.concurrency": "并发传输数",
  "transfers.concurrencyHint": "同时进行的文件传输数量上限（1–10）",

  // ─── Data / backup ───────────────────────────────────────────────────────
  "data.group.backup": "备份",
  "data.export": "导出加密备份",
  "data.exportHint": "把全部主机、分组、片段、设置与已保存凭据写入单个受密码保护的文件。",
  "data.exportAction": "导出…",
  "data.import": "导入备份",
  "data.importHint": "从备份文件恢复。这会替换当前所有数据并重启 anySCP。",
  "data.importAction": "导入…",

  "backup.selectFileTitle": "选择 anySCP 备份文件",
  "backup.saveFileTitle": "保存 anySCP 备份文件",
  "backup.fileFilter": "anySCP 备份文件",
  "backup.title.export": "导出加密备份",
  "backup.title.import": "导入备份",
  "backup.exportBody": "请设置用于加密备份的密码。恢复时需要该密码，没有它无法找回数据。",
  "backup.importBody": "请输入创建该备份时使用的密码。导入会替换当前所有数据并重启 anySCP。",
  "backup.passwordPlaceholder": "备份密码",
  "backup.confirmPassword": "确认密码",
  "backup.confirmPlaceholder": "再次输入密码",
  "backup.passwordMismatch": "两次输入的密码不一致。",
  "backup.passwordHint": "至少 {min} 个字符",
  "backup.exportAction": "选择文件并导出",
  "backup.exporting": "正在导出…",
  "backup.importAction": "导入并重启",
  "backup.restoring": "正在恢复…",
  "backup.savedToast": "加密备份已保存。",
  "backup.exportFailedToast": "无法导出备份。",
  "backup.importFailedToast": "导入失败。",

  // ─── Data / danger zone ──────────────────────────────────────────────────
  "data.group.danger": "危险操作",
  "data.clearAll": "清除所有数据",
  "data.clearAllHint":
    "永久删除所有已保存的主机、分组、连接历史、片段、端口转发规则与 S3 连接，以及它们已保存的凭据和全部应用偏好设置。anySCP 将回到首次启动的状态。此操作无法撤销。",
  "data.clearAllAction": "清除所有数据…",
  "reset.title": "清除所有数据？",
  "reset.bodyPrefix": "此操作将永久删除",
  "reset.bodyEmphasis": "全部",
  "reset.bodySuffix":
    "已保存的主机、分组、历史记录、片段、端口转发规则、S3 连接、已保存凭据与偏好设置。anySCP 将全新启动，此操作无法撤销。",
  "reset.typePrefix": "请输入",
  "reset.typeSuffix": "以确认",
  "reset.action": "清除所有数据",
  "reset.clearing": "正在清除…",
  "reset.failedToast": "无法清除数据，请重试。",

  // ─── Editors ─────────────────────────────────────────────────────────────
  "editors.group": "编辑器",
  "editors.empty": "尚未配置编辑器。可扫描已安装的编辑器，或手动添加。",
  "editors.scan": "扫描编辑器",
  "editors.scanning": "正在扫描…",
  "editors.addCustom": "添加自定义编辑器",
  "editors.starHint": "标星的编辑器用于「编辑」，其余出现在「打开方式」中。",
  "editors.group.found": "本机检测到",
  "editors.defaultEditor": "默认编辑器",
  "editors.setAsDefault": "设为默认",
  "editors.removeNamed": "移除 {name}",
  "editors.addTitle": "添加编辑器",
  "editors.namePlaceholder": "例如 Sublime Text",
  "editors.executablePath": "可执行文件路径",
  "editors.pathPlaceholder": "/path/to/editor",
  "editors.arguments": "参数",
  "editors.argsHintPrefix": "使用",
  "editors.argsHintSuffix": "指定文件位置。若省略，则自动追加到末尾。",
  "editors.selectExecutableTitle": "选择编辑器可执行文件",
  "editors.addAction": "添加编辑器",
  "editors.noneFoundToast": "本机未检测到编辑器。",
  "editors.allAddedToast": "已检测到的编辑器都已添加。",
  "editors.scanFailedToast": "无法扫描编辑器。",

  // ─── Editors (fallback copy for src/lib/editor-errors.ts) ─────────────────
  "editors.launchFailedHint": "无法打开编辑器，请在「设置 → 编辑器」中配置一个。",

  // ─── About ───────────────────────────────────────────────────────────────
  "about.group": "关于",
  "about.tagline": "一个面向 SSH、SFTP 与 S3 的现代化桌面客户端",
  "about.repository": "代码仓库",
  "about.repositoryHint": "在 GitHub 上查看源码、提交问题与发布版本",
  "about.group.updates": "更新",
  "about.autoUpdate": "自动更新",
  "about.autoUpdateHint": "在后台下载并安装更新，下次启动时生效",
};
