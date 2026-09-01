import { useState } from "react";
import { Activity, Pencil, TerminalSquare, Copy, Trash2, FolderOpen, Waypoints } from "lucide-react";
import type { SavedHost } from "../../types";
import { CardActionButton, CardActionStrip } from "./CardActionButton";
import { relativeTime } from "../../utils/time";
import { ContextMenu } from "../shared/ContextMenu";
import { ConfirmDangerDialog } from "../shared/ConfirmDangerDialog";
import { useHealthStore, IDLE_HEALTH, type HealthStatus } from "../../stores/health-store";
import { useHostsStore } from "../../stores/hosts-store";
import { useTranslation } from "../../i18n";

// Single source of truth for status → colour, shared by the button and the label.
function statusColor(status: HealthStatus): string {
  if (status === "reachable") return "text-status-connected";
  if (status === "checking") return "text-status-connecting";
  if (status === "idle") return "text-text-muted";
  return "text-status-error";
}

interface HostCardProps {
  host: SavedHost;
  onConnect: (host: SavedHost) => void;
  onExplore: (host: SavedHost) => void;
  onEdit: (hostId: string) => void;
  onDelete: (hostId: string) => void;
  onDuplicate: (host: SavedHost) => void;
}

export const HOST_COLORS = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
];

export function getHostColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return HOST_COLORS[Math.abs(hash) % HOST_COLORS.length];
}

// ─── Environment badge ────────────────────────────────────────────────────────

type EnvironmentValue = "production" | "staging" | "dev" | "testing";

const ENV_BADGE_CLASSES: Record<EnvironmentValue, string> = {
  production: "bg-[oklch(0.650_0.200_25/0.15)] text-[oklch(0.650_0.200_25)]",
  staging:    "bg-[oklch(0.750_0.160_80/0.15)] text-[oklch(0.750_0.160_80)]",
  dev:        "bg-[oklch(0.720_0.180_155/0.15)] text-[oklch(0.720_0.180_155)]",
  testing:    "bg-[oklch(0.700_0.150_250/0.15)] text-[oklch(0.700_0.150_250)]",
};

const ENV_LABELS: Record<EnvironmentValue, string> = {
  production: "PROD",
  staging:    "STAGE",
  dev:        "DEV",
  testing:    "TEST",
};

function isEnvironmentValue(val: string): val is EnvironmentValue {
  return val === "production" || val === "staging" || val === "dev" || val === "testing";
}

// ─── Component ────────────────────────────────────────────────────────────────

export function HostCard({ host, onConnect, onExplore, onEdit, onDelete, onDuplicate }: HostCardProps) {
  const { t } = useTranslation();
  const displayName = host.label || host.host;
  const avatarColor = host.color || getHostColor(host.host);
  const initial = displayName.charAt(0).toUpperCase();

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Health lives in a store (keyed by host id), not local state, so a status
  // survives the dashboard unmounting when a terminal/other tab becomes active.
  const health = useHealthStore((s) => s.byHostId[host.id] ?? IDLE_HEALTH);
  const checkHealth = useHealthStore((s) => s.checkHealth);

  // Resolve the ProxyJump / tunnel host (if any) for the "via …" badge.
  const jumpHost = useHostsStore((s) =>
    host.proxy_jump_host_id
      ? s.hosts.find((h) => h.id === host.proxy_jump_host_id) ?? null
      : null,
  );
  const jumpLabel = jumpHost ? jumpHost.label || jumpHost.host : null;

  // Build subtitle segments
  const subtitleParts: string[] = [t("dashboard.hostCard.subtitle", { username: host.username })];
  if (host.os_type) {
    const osLabels: Record<string, string> = {
      linux: "Linux",
      macos: "macOS",
      windows: "Windows",
      freebsd: "FreeBSD",
    };
    subtitleParts.push(osLabels[host.os_type] ?? host.os_type);
  }
  const lastSeen = host.last_connected_at ? relativeTime(host.last_connected_at) : null;
  if (lastSeen) subtitleParts.push(lastSeen);

  const subtitle = subtitleParts.join(" · ");

  const env = host.environment && isEnvironmentValue(host.environment) ? host.environment : null;

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  const contextItems = [
    {
      label: t("dashboard.hostCard.ping"),
      icon: Activity,
      onClick: () => void checkHealth(host.id),
    },
    {
      label: t("dashboard.hostCard.terminal"),
      icon: TerminalSquare,
      onClick: () => onConnect(host),
    },
    {
      label: t("dashboard.hostCard.explorer"),
      icon: FolderOpen,
      onClick: () => onExplore(host),
    },
    {
      label: t("common.edit"),
      icon: Pencil,
      onClick: () => onEdit(host.id),
    },
    {
      label: t("common.duplicate"),
      icon: Copy,
      onClick: () => onDuplicate(host),
    },
    {
      label: t("common.delete"),
      icon: Trash2,
      danger: true,
      onClick: () => setConfirmDelete(true),
    },
  ];

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onConnect(host);
    }
  };

  const healthLabel = (() => {
    if (health.status === "idle") return null;
    if (health.status === "checking") return t("dashboard.health.checking");
    const latency = health.latencyMs !== null ? ` · ${health.latencyMs}ms` : "";
    if (health.status === "reachable") return t("dashboard.health.reachable", { latency });
    if (health.status === "dnsFailed") return t("dashboard.health.dnsFailed");
    if (health.status === "portClosed") return t("dashboard.health.portClosed");
    if (health.status === "sshFailed") return t("dashboard.health.sshFailed");
    return t("dashboard.health.failed");
  })();

  return (
    <>
      <div
        data-testid={`host-card-${host.id}`}
        data-host-id={host.id}
        data-host-label={displayName}
        role="button"
        tabIndex={0}
        onClick={() => onConnect(host)}
        onKeyDown={handleKeyDown}
        onContextMenu={handleContextMenu}
        title={t("dashboard.hostCard.connectTo", { name: displayName })}
        className={[
          // grab/grabbing communicates the card is draggable; the click-to-connect
          // action still fires for a plain click (drag needs a 5px move first).
          "group relative isolate flex flex-col gap-2.5 p-3.5 rounded-xl text-left w-full h-full cursor-grab active:cursor-grabbing overflow-hidden",
          "bg-bg-surface border border-border",
          "hover:border-border-focus hover:bg-bg-overlay",
          "transition-[background-color,border-color] duration-[var(--duration-fast)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        ].join(" ")}
      >

        {/* Color accent gradient */}
        <div
          className="absolute inset-0 pointer-events-none -z-10 opacity-70 group-hover:opacity-100 transition-opacity duration-[var(--duration-fast)]"
          style={{
            background: `radial-gradient(circle at top left, ${avatarColor}33, transparent 60%)`,
          }}
          aria-hidden="true"
        />

        {/* Action buttons (top-right) */}
        <CardActionStrip>
          <CardActionButton
            icon={Activity}
            label={t("dashboard.hostCard.ping")}
            onClick={() => void checkHealth(host.id)}
            ariaLabel={t("dashboard.hostCard.pingAria", { name: displayName })}
            detail={health.message ?? undefined}
            testId={`host-card-${host.id}-health`}
            disabled={health.status === "checking"}
            busy={health.status === "checking"}
            colorClass={statusColor(health.status)}
          />
          <CardActionButton
            icon={TerminalSquare}
            label={t("dashboard.hostCard.terminal")}
            onClick={() => onConnect(host)}
            ariaLabel={t("dashboard.hostCard.openTerminalFor", { name: displayName })}
            testId={`host-card-${host.id}-terminal`}
          />
          <CardActionButton
            icon={FolderOpen}
            label={t("dashboard.hostCard.explorer")}
            onClick={() => onExplore(host)}
            ariaLabel={t("dashboard.hostCard.openExplorerFor", { name: displayName })}
            testId={`host-card-${host.id}-explorer`}
          />
        </CardActionStrip>

        {/* Avatar circle */}
        <div
          className="flex items-center justify-center w-9 h-9 rounded-full shrink-0 font-semibold text-[length:var(--text-sm)] select-none"
          style={{
            backgroundColor: `${avatarColor}25`,
            color: avatarColor,
            fontFamily: "var(--font-sans)",
          }}
          aria-hidden="true"
        >
          {initial}
        </div>

        {/* Host info */}
        <div className="min-w-0">
          <p className="text-[length:var(--text-sm)] font-medium text-text-primary truncate leading-tight pr-24">
            {displayName}
          </p>
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            <p className="text-[length:var(--text-xs)] text-text-muted font-mono truncate">
              {subtitle}
            </p>
            {env && (
              <span
                className={[
                  "inline-flex items-center px-1 py-px rounded text-[11px] font-semibold tracking-wide leading-none shrink-0",
                  ENV_BADGE_CLASSES[env],
                ].join(" ")}
              >
                {ENV_LABELS[env]}
              </span>
            )}
          </div>
          {jumpLabel && (
            <div
              data-testid={`host-card-${host.id}-tunnel`}
              className="flex items-center gap-1 mt-0.5 text-[length:var(--text-xs)] text-text-muted truncate"
              title={t("dashboard.hostCard.tunnelsThrough", { name: jumpLabel })}
            >
              <Waypoints size={11} strokeWidth={2} aria-hidden="true" className="shrink-0" />
              <span className="truncate">{t("dashboard.hostCard.via", { name: jumpLabel })}</span>
            </div>
          )}
          {/* Always-mounted live region: announces the result to screen
              readers and reserves a line so checking a host doesn't shift the
              card height (and its row neighbours in the stretch grid). */}
          <p
            data-testid={`host-card-${host.id}-health-status`}
            role="status"
            aria-live="polite"
            className={[
              "mt-1 min-h-[1rem] text-[length:var(--text-xs)] font-medium truncate",
              healthLabel ? statusColor(health.status) : "",
            ].join(" ")}
            title={health.message ?? undefined}
          >
            {healthLabel}
          </p>
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
        title={t("dashboard.hostCard.deleteTitle")}
        message={t("dashboard.hostCard.deleteMessage")}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          onDelete(host.id);
        }}
      />
    </>
  );
}
