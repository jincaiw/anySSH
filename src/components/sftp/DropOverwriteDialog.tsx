import { AlertTriangle } from "lucide-react";
import { ModalShell, BTN_GHOST, BTN_PRIMARY } from "../shared/ModalShell";
import { useTranslation } from "../../i18n";

interface DropOverwriteDialogProps {
  conflicts: string[];
  targetDir: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Confirmation shown when a drag-drop upload would overwrite existing remote
 * entries. The conflict list is computed from top-level basenames, so for a
 * dropped folder the match means the folder already exists — its contents are
 * merged and only same-named files inside are replaced.
 */
export function DropOverwriteDialog({
  conflicts,
  targetDir,
  onConfirm,
  onCancel,
}: DropOverwriteDialogProps) {
  const { t } = useTranslation();
  const count = conflicts.length;

  return (
    <ModalShell
      open
      onClose={onCancel}
      // The catalogue guard resolves statically-written keys, so the CLDR
      // plural suffix is picked here instead of letting `t()` build it from
      // `{ count }` (which would leave a base key it cannot resolve).
      title={count === 1 ? t("sftp.overwrite.title_one") : t("sftp.overwrite.title_other", { count })}
      icon={AlertTriangle}
      iconVariant="danger"
      maxWidth="sm"
      testId="explorer-overwrite-confirm"
      footer={
        <>
          {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
          <button autoFocus data-testid="explorer-overwrite-cancel" type="button" onClick={onCancel} className={BTN_GHOST}>
            {t("common.cancel")}
          </button>
          <button data-testid="explorer-overwrite-confirm-button" type="button" onClick={onConfirm} className={BTN_PRIMARY}>
            {t("sftp.overwrite.confirm", { count })}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-[length:var(--text-sm)] text-text-secondary">
          {count === 1 ? (
            <><span className="font-mono text-text-primary">{conflicts[0]}</span> {t("sftp.overwrite.bodySingle")}</>
          ) : (
            <>{t("sftp.overwrite.bodyMultiple", { count })}</>
          )}
        </p>
        {count > 1 && (
          <ul className="max-h-32 overflow-y-auto rounded-md bg-bg-base border border-border/60 p-2 flex flex-col gap-0.5">
            {conflicts.map((n) => (
              <li key={n} className="font-mono text-[length:var(--text-2xs)] text-text-secondary truncate">{n}</li>
            ))}
          </ul>
        )}
        <p className="text-[length:var(--text-2xs)] text-text-muted">
          {t("sftp.overwrite.note")}
        </p>
        <p className="font-mono text-[length:var(--text-2xs)] text-text-muted truncate">{targetDir}</p>
      </div>
    </ModalShell>
  );
}
