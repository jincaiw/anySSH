// ─── explorer (zh-CN) ───────────────────────────────────────────────────────
//
// Shared file browser: table, toolbar, properties, context menu.
//
// Keys are written WITHOUT the `explorer.` prefix — the locale index adds it.
// Must mirror ../en-US/explorer.ts key-for-key (src/i18n/__tests__/i18n-parity.test.ts).

export default {
  // ─── Table ───────────────────────────────────────────────────────────────
  class: "存储类别",
  "list.label": "目录内容",

  // ─── Entry type ──────────────────────────────────────────────────────────
  "type.File": "文件",
  "type.Directory": "目录",
  "type.Symlink": "符号链接",
  "type.Other": "其他",

  // ─── Empty state ─────────────────────────────────────────────────────────
  "empty.title": "此文件夹为空",
  "empty.hint": "右键查看更多选项",

  // ─── Inline create / rename rows ─────────────────────────────────────────
  "rename.ariaLabel": "重命名文件",
  "newFolder.placeholder": "文件夹名称",
  "newFolder.ariaLabel": "新文件夹名称",
  "newFile.ariaLabel": "新文件名称",

  // ─── Context menu ────────────────────────────────────────────────────────
  "menu.editIn": "在 {name} 中编辑",
  "menu.openWith": "打开方式",
  "menu.downloadFolder": "下载文件夹",
  "menu.copyPresignedUrl": "复制预签名 URL",
  "menu.copyPath": "复制路径",
  "menu.properties": "属性",
  "menu.downloadCount_one": "下载 {count} 项",
  "menu.downloadCount_other": "下载 {count} 项",
  "menu.copyCount_one": "复制 {count} 项",
  "menu.copyCount_other": "复制 {count} 项",
  "menu.cutCount_one": "剪切 {count} 项",
  "menu.cutCount_other": "剪切 {count} 项",
  "menu.deleteCount_one": "删除 {count} 项",
  "menu.deleteCount_other": "删除 {count} 项",

  // ─── Drag ghost ──────────────────────────────────────────────────────────
  "drag.copyCount_one": "复制 {count} 项",
  "drag.copyCount_other": "复制 {count} 项",
  "drag.moveCount_one": "移动 {count} 项 · ⌥ 复制",
  "drag.moveCount_other": "移动 {count} 项 · ⌥ 复制",

  // ─── Delete confirmation ─────────────────────────────────────────────────
  "delete.title": "删除{type}",
  "delete.titleCount_one": "删除 {count} 项",
  "delete.titleCount_other": "删除 {count} 项",
  "delete.confirmSingle": "将被永久删除。",
  "delete.confirmSingleDir": "其中的所有内容也会一并移除。",
  "delete.confirmMany": "{count} 项将被永久删除。",
  "delete.confirmManyDirs": "目录及其全部内容都会被移除。",

  // ─── Drop zone ───────────────────────────────────────────────────────────
  "drop.ariaLabel": "拖放文件以上传",
  "drop.title": "拖放文件以上传",
  "drop.intoFolder": "拖放到 {name} 中上传",

  // ─── Toolbar ─────────────────────────────────────────────────────────────
  "toolbar.goToRoot": "前往 {name}",
  "toolbar.goToRootAria": "回到根目录",
  "toolbar.editPathAria": "编辑当前路径",
  "toolbar.clickToEdit": "点击输入路径",
  "toolbar.currentPathAria": "当前路径",
  "toolbar.busyAria": "操作进行中",
  "toolbar.uploadFiles": "上传文件",
  "toolbar.uploadFolder": "上传文件夹",
  "toolbar.newFile": "新建文件",
  "toolbar.newFolder": "新建文件夹",
  "toolbar.navigateTo": "前往 {path}",
  "toolbar.sudoEnable": "启用 sudo 模式",
  "toolbar.sudoDisable": "停用 sudo 模式",

  // ─── Properties dialog ───────────────────────────────────────────────────
  "properties.ariaLabel": "{name} 的属性",
  "properties.location": "所在目录",
  "properties.copyPath": "复制路径",
  "properties.read": "读取",
  "properties.write": "写入",
  "properties.execute": "执行",
  "properties.octal": "八进制",
  "properties.octalAria": "八进制权限",
  "properties.readOnlySymlink": "只读（符号链接）",
  "properties.specialBits": "已设置特殊权限位（{bits}）；此处不可编辑，且",
  "properties.specialBitsDropped": "递归应用时会被丢弃。",
  "properties.specialBitsPreserved": "应用时会保留。",
  "properties.recursive": "将权限递归应用到所有内容",
  "properties.applyFailed": "修改权限失败",
  "properties.appliedSummary": "已应用到 {applied} 项，{errors} 项失败。{first}",
  "properties.appliedSummaryNoApplied": "已应用，{errors} 项失败。{first}",
};
