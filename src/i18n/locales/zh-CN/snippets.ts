// ─── snippets (zh-CN) ───────────────────────────────────────────────────────
//
// Command snippet library: cards, folders, palette, variables.
//
// Keys are written WITHOUT the `snippets.` prefix — the locale index adds it.
// Must mirror ../en-US/snippets.ts key-for-key (src/i18n/__tests__/i18n-parity.test.ts).

export default {
  // ─── 片段页面 ──────────────────────────────────────────────────────────────
  "page.title": "片段",
  "page.subtitle": "保存常用命令，按文件夹归类整理，一键执行",
  "page.searchPlaceholder": "搜索片段... (Cmd+F)",
  "page.searchAria": "搜索片段",
  "page.newSnippet": "新建片段",
  "page.newSnippetTitle": "新建片段 (Cmd+N)",
  "page.folders": "文件夹",
  "page.backToAll": "返回全部片段",
  "page.allSnippets": "全部片段",
  "page.resultsFor": '“{query}” 的搜索结果',
  "page.loading": "加载中...",
  "page.noMatch": "没有匹配 “{query}” 的片段",
  "page.emptyFolder": "该文件夹下还没有片段。",
  "page.emptyTitle": "还没有片段",
  // `{{variables}}` 是用户数据，由 JSX 渲染成带样式的 <span>，不参与 i18n 插值。
  "page.emptyHintPrefix": "创建可复用的命令，使用 ",
  "page.emptyHintSuffix": " 即可一键执行。",
  "page.copySuffix": "{name}（副本）",

  // ─── 片段卡片 ──────────────────────────────────────────────────────────────
  "card.editHint": "编辑片段",
  "card.dangerousAria": "危险 — 需要确认",
  "card.usedCount": "已使用 {count} 次 · {lastUsed}",
  "card.neverUsed": "从未使用",
  "card.deleteTitle": "删除这个片段？",
  "card.deleteMessage": "该片段将被永久删除。",
  "card.lastUsedNever": "从未",
  "card.lastUsedToday": "今天",
  "card.lastUsedYearsAgo": "{count} 年前",

  // ─── 文件夹卡片 ────────────────────────────────────────────────────────────
  // 未使用 `_one`/`_other` 后缀：调用处已自行分支，且目录校验会解析静态写入的键
  // （见 src/i18n/__tests__/i18n-parity.test.ts）。
  "folderCard.deleteFolder": "删除文件夹",
  "folderCard.snippetCountOne": "1 个片段",
  "folderCard.snippetCountOther": "{count} 个片段",
  "folderCard.deleteTitle": "删除这个文件夹？",
  "folderCard.deleteMessage": "该文件夹将被永久删除。",

  // ─── 新建文件夹弹窗 ────────────────────────────────────────────────────────
  "folderModal.creating": "创建中…",
  "folderModal.create": "创建文件夹",
  "folderModal.namePlaceholder": "例如：Web 服务器、Docker、数据库",
  "folderModal.colorAria": "颜色 {color}",
  "folderModal.nameRequired": "文件夹名称不能为空",
  "folderModal.saveFailed": "保存文件夹失败",

  // ─── 新建 / 编辑片段弹窗 ───────────────────────────────────────────────────
  "editModal.titleNew": "新建片段",
  "editModal.titleEdit": "编辑片段",
  "editModal.saving": "保存中…",
  "editModal.commandLabel": "命令",
  "editModal.namePlaceholder": "例如：重启 Nginx",
  // `{{service}}` 是用户数据，不会被 i18n 插值处理。
  "editModal.commandPlaceholder": "例如：sudo systemctl restart {{service}}",
  // 与 JSX 中带样式的 `{{variable_name}}` 拼接渲染，参见 page.emptyHint*。
  "editModal.variableHintPrefix": "使用 ",
  "editModal.variableHintSuffix": " 语法定义变量。",
  "editModal.descriptionPlaceholder": "可选 — 描述这个片段的作用",
  "editModal.noFolder": "无文件夹",
  "editModal.tags": "标签",
  "editModal.tagsPlaceholder": "nginx, restart, devops",
  "editModal.dangerousFlag": "标记为危险操作",
  "editModal.dangerousHelp": "执行前需要确认。",
  "editModal.variables": "变量",
  "editModal.detected": "检测到 {count} 个",
  "editModal.colVariable": "变量",
  "editModal.colOptions": "选项",
  "editModal.colReq": "必填",
  "editModal.optionsLabel": "选项（英文逗号分隔）",
  "editModal.optionsPlaceholder": "例如：start, stop, restart, status",
  "editModal.displayLabelPlaceholder": "显示标签",
  "editModal.defaultValuePlaceholder": "默认值",
  "editModal.nameRequired": "名称不能为空",
  "editModal.commandRequired": "命令不能为空",
  "editModal.saveFailed": "保存片段失败",

  // ─── 变量填写对话框 ────────────────────────────────────────────────────────
  "variableDialog.execute": "执行",
  "variableDialog.dangerousWarning": "该片段已标记为危险操作。执行前请仔细检查解析后的命令。",
  "variableDialog.autoFilled": "自动填充",
  "variableDialog.noActiveSession": "（无活动会话）",
  "variableDialog.variables": "变量",
  "variableDialog.enterPlaceholder": "输入 {name}",
  "variableDialog.requiredAria": "必填",
  "variableDialog.selectPlaceholder": "— 请选择 —",
  "variableDialog.noVariables": "没有需要填写的变量。",

  // ─── 命令面板 ──────────────────────────────────────────────────────────────
  "palette.searchPlaceholder": "搜索片段...",
  "palette.noMatch": '没有匹配 "{query}" 的片段',
  "palette.empty": "还没有保存任何片段",
  "palette.hintNavigate": "切换",
  "palette.hintExecute": "执行",
  "palette.hintClose": "关闭",
  "palette.back": "返回 (Esc)",
  "palette.dangerous": "危险命令",
  "palette.run": "运行",
  "palette.hintNextField": "下一项",
  "palette.hintRun": "运行",
  "palette.hintBack": "返回",

  // ─── 侧边快捷面板（停靠 / 浮动）────────────────────────────────────────────
  "quickPanel.ariaLabel": "片段快捷面板",
  "quickPanel.unpinTitle": "取消固定面板（浮动）",
  "quickPanel.pinTitle": "固定面板（停靠）",
  "quickPanel.unpinAria": "取消固定片段面板",
  "quickPanel.pinAria": "固定片段面板",
  "quickPanel.closeTitle": "关闭面板 (Escape)",
  "quickPanel.closeAria": "关闭片段面板",
  "quickPanel.recentlyUsed": "最近使用",
  "quickPanel.empty": "还没有保存任何片段。",
};
