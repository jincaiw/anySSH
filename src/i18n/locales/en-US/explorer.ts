// ─── explorer (en-US) ───────────────────────────────────────────────────────
//
// Shared file browser: table, toolbar, properties, context menu.
//
// Keys are written WITHOUT the `explorer.` prefix — the locale index adds it.
// Bars are E2E-visible: keep them identical to the previous hard-coded copy.

export default {
  // ─── Table ───────────────────────────────────────────────────────────────
  // Column headers: Name / Size / Modified / Permissions reuse common.*.
  class: "Class",
  "list.label": "Directory contents",

  // ─── Entry type ──────────────────────────────────────────────────────────
  // Backend discriminants, mapped for display by `fileTypeLabel()` in
  // src/lib/file-types.ts. Unknown values fall back to the raw string.
  "type.File": "File",
  "type.Directory": "Directory",
  "type.Symlink": "Symlink",
  "type.Other": "Other",

  // ─── Empty state ─────────────────────────────────────────────────────────
  "empty.title": "This folder is empty",
  "empty.hint": "Right-click for more options",

  // ─── Inline create / rename rows ─────────────────────────────────────────
  "rename.ariaLabel": "Rename file",
  "newFolder.placeholder": "Folder name",
  "newFolder.ariaLabel": "New folder name",
  "newFile.ariaLabel": "New file name",

  // ─── Context menu ────────────────────────────────────────────────────────
  "menu.editIn": "Edit in {name}",
  "menu.openWith": "Open With",
  "menu.downloadFolder": "Download Folder",
  "menu.copyPresignedUrl": "Copy Presigned URL",
  "menu.copyPath": "Copy Path",
  "menu.properties": "Properties",
  "menu.downloadCount_one": "Download {count} item",
  "menu.downloadCount_other": "Download {count} items",
  "menu.copyCount_one": "Copy {count} item",
  "menu.copyCount_other": "Copy {count} items",
  "menu.cutCount_one": "Cut {count} item",
  "menu.cutCount_other": "Cut {count} items",
  "menu.deleteCount_one": "Delete {count} item",
  "menu.deleteCount_other": "Delete {count} items",

  // ─── Drag ghost ──────────────────────────────────────────────────────────
  "drag.copyCount_one": "Copy {count} item",
  "drag.copyCount_other": "Copy {count} items",
  "drag.moveCount_one": "Move {count} item · ⌥ to copy",
  "drag.moveCount_other": "Move {count} items · ⌥ to copy",

  // ─── Delete confirmation ─────────────────────────────────────────────────
  "delete.title": "Delete {type}",
  "delete.titleCount_one": "Delete {count} item",
  "delete.titleCount_other": "Delete {count} items",
  "delete.confirmSingle": "will be permanently deleted.",
  "delete.confirmSingleDir": " All contents inside will also be removed.",
  "delete.confirmMany": "{count} items will be permanently deleted.",
  "delete.confirmManyDirs": " Directories and all their contents will be removed.",

  // ─── Drop zone ───────────────────────────────────────────────────────────
  "drop.ariaLabel": "Drop files to upload",
  "drop.title": "Drop files to upload",
  "drop.intoFolder": "Drop to upload into {name}",

  // ─── Toolbar ─────────────────────────────────────────────────────────────
  "toolbar.goToRoot": "Go to {name}",
  "toolbar.goToRootAria": "Go to root",
  "toolbar.editPathAria": "Edit current path",
  "toolbar.clickToEdit": "Click to type a path",
  "toolbar.currentPathAria": "Current path",
  "toolbar.busyAria": "Operation in progress",
  "toolbar.uploadFiles": "Upload files",
  "toolbar.uploadFolder": "Upload folder",
  "toolbar.newFile": "New file",
  "toolbar.newFolder": "New folder",
  "toolbar.navigateTo": "Navigate to {path}",
  "toolbar.sudoEnable": "Enable sudo mode",
  "toolbar.sudoDisable": "Disable sudo mode",

  // ─── Properties dialog ───────────────────────────────────────────────────
  "properties.ariaLabel": "Properties for {name}",
  "properties.location": "Location",
  "properties.copyPath": "Copy path",
  "properties.read": "Read",
  "properties.write": "Write",
  "properties.execute": "Execute",
  "properties.octal": "Octal",
  "properties.octalAria": "Octal permissions",
  "properties.readOnlySymlink": "read-only (symlink)",
  "properties.specialBits": "Special bits set ({bits}); not editable here and",
  "properties.specialBitsDropped": "dropped on a recursive apply.",
  "properties.specialBitsPreserved": "preserved on apply.",
  "properties.recursive": "Apply permissions recursively to all contents",
  "properties.applyFailed": "Failed to change permissions",
  "properties.appliedSummary": "Applied to {applied} item(s), {errors} error(s). {first}",
  "properties.appliedSummaryNoApplied": "Applied, {errors} error(s). {first}",
};
