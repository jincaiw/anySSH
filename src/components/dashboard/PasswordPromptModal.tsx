import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, KeyRound } from "lucide-react";
import { ModalShell, BTN_GHOST, BTN_PRIMARY } from "../shared/ModalShell";
import { useTranslation } from "../../i18n";

/**
 * PuTTY/Xshell-style interactive password prompt, shown when the user
 * connects to a password-auth host that has no password saved in the vault.
 * The entered password is used for this one connection; it is only persisted
 * when the user ticks "remember".
 */
export function PasswordPromptModal(props: {
  /** Subtitle shown under the title, e.g. "420102-7@29.10.122". */
  target: string;
  busy?: boolean;
  onSubmit: (password: string, remember: boolean) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Fresh dialog each time it opens.
    setPassword("");
    setRemember(false);
    setShow(false);
    setError(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const submit = () => {
    if (!password) {
      setError(t("dashboard.connect.passwordRequired"));
      inputRef.current?.focus();
      return;
    }
    props.onSubmit(password, remember);
  };

  return (
    <ModalShell
      open
      onClose={props.onClose}
      title={t("dashboard.connect.passwordPromptTitle")}
      subtitle={props.target}
      icon={KeyRound}
      maxWidth="sm"
      busy={props.busy}
      testId="password-prompt-modal"
      footer={
        <>
          <button type="button" className={BTN_GHOST} onClick={props.onClose} disabled={props.busy}>
            {t("dashboard.connect.passwordCancel")}
          </button>
          <button type="button" className={BTN_PRIMARY} onClick={submit} disabled={props.busy}>
            {t("dashboard.connect.passwordSubmit")}
          </button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label className="block text-[length:var(--text-xs)] font-medium text-text-secondary mb-1" htmlFor="password-prompt-input">
          {t("dashboard.connect.passwordLabel")}
        </label>
        <div className="relative">
          <input
            id="password-prompt-input"
            ref={inputRef}
            type={show ? "text" : "password"}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (error) setError(null);
            }}
            placeholder={t("dashboard.connect.passwordPlaceholder")}
            autoComplete="off"
            disabled={props.busy}
            className="w-full pr-10 px-3 py-2 rounded-lg text-[length:var(--text-sm)] bg-bg-base border border-border text-text-primary placeholder:text-text-muted outline-none focus:border-border-focus focus:ring-2 focus:ring-ring transition-[border-color,box-shadow] duration-[var(--duration-fast)] disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? t("dashboard.connect.passwordHide") : t("dashboard.connect.passwordShow")}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-text-muted hover:text-text-primary transition-colors"
          >
            {show ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        {error && (
          <p className="mt-1.5 text-[length:var(--text-xs)] text-red-400" data-testid="password-prompt-error">
            {error}
          </p>
        )}
        <label className="mt-3 flex items-center gap-2 text-[length:var(--text-sm)] text-text-secondary cursor-pointer select-none w-fit">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            disabled={props.busy}
            className="accent-[var(--accent)] w-4 h-4"
          />
          {t("dashboard.connect.passwordRemember")}
        </label>
      </form>
    </ModalShell>
  );
}
