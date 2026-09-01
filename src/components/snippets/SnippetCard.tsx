import { useState } from "react";
import { Pencil, Copy, Trash2, AlertTriangle } from "lucide-react";
import type { Snippet } from "../../types";
import { useTranslation } from "../../i18n";
import type { TVars } from "../../i18n";
import { ContextMenu } from "../shared/ContextMenu";
import { ConfirmDangerDialog } from "../shared/ConfirmDangerDialog";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const VAR_REGEX = /(\{\{[a-zA-Z_][a-zA-Z0-9_]*\}\})/g;

type Translate = (key: string, vars?: TVars) => string;

/** Render a command string with {{variable}} tokens highlighted. */
function HighlightedCommand({ command }: { command: string }) {
  const parts = command.split(VAR_REGEX);
  return (
    <span>
      {parts.map((part, i) =>
        VAR_REGEX.test(part) ? (
          <span key={i} className="text-accent font-medium">
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </span>
  );
}

function formatLastUsed(iso: string | null, t: Translate): string {
  if (!iso) return t("snippets.card.lastUsedNever");
  const date = new Date(iso);
  const now = Date.now();
  const diff = now - date.getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return t("snippets.card.lastUsedToday");
  if (days === 1) return t("common.time.yesterday");
  if (days < 30) return t("common.time.daysAgo", { count: days });
  const months = Math.floor(days / 30);
  if (months < 12) return t("common.time.monthsAgo", { count: months });
  return t("snippets.card.lastUsedYearsAgo", { count: Math.floor(months / 12) });
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface SnippetCardProps {
  snippet: Snippet;
  onEdit: (snippet: Snippet) => void;
  onDelete: (id: string) => void;
  onDuplicate: (snippet: Snippet) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SnippetCard({ snippet, onEdit, onDelete, onDuplicate }: SnippetCardProps) {
  const { t } = useTranslation();
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  const tags = snippet.tags
    ? snippet.tags.split(",").map((t) => t.trim()).filter(Boolean)
    : [];

  const contextItems = [
    {
      label: t("common.edit"),
      icon: Pencil,
      onClick: () => onEdit(snippet),
    },
    {
      label: t("common.duplicate"),
      icon: Copy,
      onClick: () => onDuplicate(snippet),
    },
    {
      label: t("common.delete"),
      icon: Trash2,
      danger: true,
      onClick: () => setConfirmDelete(true),
    },
  ];

  return (
    <>
      <div
        data-testid={`snippet-card-${snippet.id}`}
        data-snippet-id={snippet.id}
        data-snippet-name={snippet.name}
        onContextMenu={handleContextMenu}
        className={[
          "group flex flex-col gap-2 p-4 rounded-xl",
          "bg-bg-surface border border-border",
          "hover:border-border-focus hover:bg-bg-overlay",
          "transition-all duration-[var(--duration-fast)]",
        ].join(" ")}
      >
        {/* Top row: name + actions */}
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-[length:var(--text-sm)] font-semibold text-text-primary leading-tight truncate">
                {snippet.name}
              </h3>
              {snippet.is_dangerous && (
                <AlertTriangle
                  size={14}
                  strokeWidth={2}
                  className="text-status-error shrink-0"
                  aria-label={t("snippets.card.dangerousAria")}
                />
              )}
            </div>
          </div>

          {/* Edit button — visible on hover */}
          <button
            onClick={() => onEdit(snippet)}
            title={t("snippets.card.editHint")}
            aria-label={t("snippets.card.editHint")}
            className={[
              "shrink-0 flex items-center justify-center w-7 h-7 rounded-md",
              "text-text-muted hover:text-text-secondary hover:bg-bg-subtle",
              "opacity-0 group-hover:opacity-100",
              "transition-all duration-[var(--duration-fast)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:opacity-100",
            ].join(" ")}
          >
            <Pencil size={16} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>

        {/* Command (monospace, truncated to 2 lines) */}
        <p
          className={[
            "font-mono text-[length:var(--text-xs)] text-text-muted leading-relaxed",
            "line-clamp-2 break-all",
          ].join(" ")}
        >
          <HighlightedCommand command={snippet.command} />
        </p>

        {/* Footer: tags + use count */}
        <div className="flex items-center gap-2 flex-wrap">
          {tags.map((tag) => (
            <span
              key={tag}
              className={[
                "inline-flex items-center px-1.5 py-0.5 rounded-md",
                "text-[11px] font-medium text-text-muted bg-bg-subtle border border-border",
              ].join(" ")}
            >
              {tag}
            </span>
          ))}

          <span className="ml-auto text-[11px] text-text-muted shrink-0 whitespace-nowrap">
            {snippet.use_count > 0
              ? t("snippets.card.usedCount", {
                  count: snippet.use_count,
                  lastUsed: formatLastUsed(snippet.last_used_at, t),
                })
              : t("snippets.card.neverUsed")}
          </span>
        </div>
      </div>

      {contextMenu && (
        <ContextMenu
          items={contextItems}
          position={contextMenu}
          onClose={() => setContextMenu(null)}
        />
      )}

      <ConfirmDangerDialog
        open={confirmDelete}
        title={t("snippets.card.deleteTitle")}
        message={t("snippets.card.deleteMessage")}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          onDelete(snippet.id);
        }}
      />
    </>
  );
}
