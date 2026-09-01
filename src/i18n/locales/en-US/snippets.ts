// ─── snippets (en-US) ───────────────────────────────────────────────────────
//
// Command snippet library: cards, folders, palette, variables.
//
// Keys are written WITHOUT the `snippets.` prefix — the locale index adds it.
// Bars are E2E-visible: keep them identical to the previous hard-coded copy.

export default {
  // ─── Snippets page ────────────────────────────────────────────────────────
  "page.title": "Snippets",
  "page.subtitle":
    "Save frequently used commands, organize them into folders, and execute with one click",
  "page.searchPlaceholder": "Search snippets... (Cmd+F)",
  "page.searchAria": "Search snippets",
  "page.newSnippet": "New Snippet",
  "page.newSnippetTitle": "New Snippet (Cmd+N)",
  "page.folders": "Folders",
  "page.backToAll": "Back to all snippets",
  "page.allSnippets": "All Snippets",
  "page.resultsFor": 'Results for "{query}"',
  "page.loading": "Loading...",
  "page.noMatch": "No snippets match “{query}”",
  "page.emptyFolder": "No snippets in this folder yet.",
  "page.emptyTitle": "No snippets yet",
  // The `{{variables}}` token is rendered as a styled `<span>` between these
  // two halves — it is user data, not an i18n placeholder, so it stays in JSX.
  "page.emptyHintPrefix": "Create reusable commands with ",
  "page.emptyHintSuffix": " for one-click execution.",
  "page.copySuffix": "{name} (copy)",

  // ─── Snippet card ─────────────────────────────────────────────────────────
  "card.editHint": "Edit snippet",
  "card.dangerousAria": "Dangerous — requires confirmation",
  "card.usedCount": "Used {count}x · {lastUsed}",
  "card.neverUsed": "Never used",
  "card.deleteTitle": "Delete this snippet?",
  "card.deleteMessage": "This snippet will be permanently removed.",
  "card.lastUsedNever": "never",
  "card.lastUsedToday": "today",
  "card.lastUsedYearsAgo": "{count}yr ago",

  // ─── Folder card ──────────────────────────────────────────────────────────
  // Not `_one`/`_other`: the call site already branches, and the catalogue
  // guard resolves statically-written keys (src/i18n/__tests__).
  "folderCard.deleteFolder": "Delete Folder",
  "folderCard.snippetCountOne": "1 snippet",
  "folderCard.snippetCountOther": "{count} snippets",
  "folderCard.deleteTitle": "Delete this folder?",
  "folderCard.deleteMessage": "This folder will be permanently removed.",

  // ─── Folder modal ─────────────────────────────────────────────────────────
  "folderModal.creating": "Creating…",
  "folderModal.create": "Create Folder",
  "folderModal.namePlaceholder": "e.g., Web Servers, Docker, Database",
  "folderModal.colorAria": "Color {color}",
  "folderModal.nameRequired": "Folder name is required",
  "folderModal.saveFailed": "Failed to save folder",

  // ─── Edit / create modal ──────────────────────────────────────────────────
  "editModal.titleNew": "New Snippet",
  "editModal.titleEdit": "Edit Snippet",
  "editModal.saving": "Saving…",
  "editModal.commandLabel": "Command",
  "editModal.namePlaceholder": "e.g., Restart Nginx",
  // `{{service}}` is user data — never touched by i18n interpolation.
  "editModal.commandPlaceholder": "e.g., sudo systemctl restart {{service}}",
  // Rendered around a styled `{{variable_name}}` span — see page.emptyHint*.
  "editModal.variableHintPrefix": "Use ",
  "editModal.variableHintSuffix": " syntax to define variables.",
  "editModal.descriptionPlaceholder": "Optional — describe what this snippet does",
  "editModal.noFolder": "No folder",
  "editModal.tags": "Tags",
  "editModal.tagsPlaceholder": "nginx, restart, devops",
  "editModal.dangerousFlag": "Flag as dangerous",
  "editModal.dangerousHelp": "Requires confirmation before execution.",
  "editModal.variables": "Variables",
  "editModal.detected": "{count} detected",
  "editModal.colVariable": "Variable",
  "editModal.colOptions": "Options",
  "editModal.colReq": "Req",
  "editModal.optionsLabel": "Options (comma-separated)",
  "editModal.optionsPlaceholder": "e.g., start, stop, restart, status",
  "editModal.displayLabelPlaceholder": "Display label",
  "editModal.defaultValuePlaceholder": "Default value",
  "editModal.nameRequired": "Name is required",
  "editModal.commandRequired": "Command is required",
  "editModal.saveFailed": "Failed to save snippet",

  // ─── Variable fill-in dialog ──────────────────────────────────────────────
  "variableDialog.execute": "Execute",
  "variableDialog.dangerousWarning":
    "This snippet is flagged as dangerous. Review the resolved command carefully before execution.",
  "variableDialog.autoFilled": "Auto-filled",
  "variableDialog.noActiveSession": "(no active session)",
  "variableDialog.variables": "Variables",
  "variableDialog.enterPlaceholder": "Enter {name}",
  "variableDialog.requiredAria": "required",
  "variableDialog.selectPlaceholder": "— select —",
  "variableDialog.noVariables": "No variables to fill in.",

  // ─── Command palette ──────────────────────────────────────────────────────
  "palette.searchPlaceholder": "Search snippets...",
  "palette.noMatch": 'No snippets match "{query}"',
  "palette.empty": "No snippets saved yet",
  "palette.hintNavigate": "navigate",
  "palette.hintExecute": "execute",
  "palette.hintClose": "close",
  "palette.back": "Back (Esc)",
  "palette.dangerous": "Dangerous command",
  "palette.run": "Run",
  "palette.hintNextField": "next field",
  "palette.hintRun": "run",
  "palette.hintBack": "back",

  // ─── Quick panel (docked / floating side rail) ────────────────────────────
  "quickPanel.ariaLabel": "Snippet quick panel",
  "quickPanel.unpinTitle": "Unpin panel (float)",
  "quickPanel.pinTitle": "Pin panel (dock)",
  "quickPanel.unpinAria": "Unpin snippet panel",
  "quickPanel.pinAria": "Pin snippet panel",
  "quickPanel.closeTitle": "Close panel (Escape)",
  "quickPanel.closeAria": "Close snippet panel",
  "quickPanel.recentlyUsed": "Recently Used",
  "quickPanel.empty": "No snippets saved yet.",
};
