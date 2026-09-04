import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, KeyRound, RefreshCw } from "lucide-react";
import { ModalShell, BTN_GHOST, BTN_SECONDARY, BTN_PRIMARY } from "../shared/ModalShell";
import { useTranslation } from "../../i18n";

/**
 * PuTTY/Xshell-style interactive password prompt, shown when the user
 * connects to a password-auth host that has no password saved in the vault.
 * The entered password is used for this one connection; it is only persisted
 * when the user ticks "remember".
 *
 * Dual-factor armed mode (`dualFactorArmed`): the SMS/OTP dispatch has just
 * been fired in the background, so the copy leads with "type
 * <static password><dynamic code>" and offers a resend button; the
 * "remember" checkbox is hidden (an OTP-concatenated string must never be
 * saved as the host password).
 */
export function PasswordPromptModal(props: {
  /** Subtitle shown under the title, e.g. "420102-7@29.10.122". */
  target: string;
  busy?: boolean;
  /** Dual-factor armed mode: the SMS trigger was just fired for this host. */
  dualFactorArmed?: boolean;
  /** Refire the SMS dispatch (armed mode only). */
  onResend?: () => void;
  /** Stop auto-firing the SMS trigger for this host (armed mode only). */
  onDisableAuto?: () => void;
  onSubmit: (password: string, remember: boolean) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [show, setShow] = useState(false);
  const [resending, setResending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Held in a ref so the unmount cleanup can cancel it — a bare
  // window.setTimeout would fire after the dialog closed and set state on an
  // unmounted component.
  const resendTimer = useRef<number | null>(null);

  useEffect(() => {
    // Fresh dialog each time it opens.
    setPassword("");
    setRemember(false);
    setShow(false);
    setResending(false);
    requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      if (resendTimer.current !== null) window.clearTimeout(resendTimer.current);
    };
  }, []);

  const submit = () => {
    // An EMPTY password is a valid submission: dual-factor bastions (堡垒机)
    // deliver the SMS / OTP code only after receiving a password response,
    // and connecting once with an empty password is the documented way to
    // trigger that delivery (see the hint below). The backend's dual-factor
    // retry answers the bastion's trigger prompt with a non-empty placeholder
    // when the password is empty.
    props.onSubmit(password, remember);
  };

  const resend = () => {
    if (!props.onResend || resending) return;
    setResending(true);
    props.onResend();
    // The trigger attempt is bounded on the Rust side (60s); re-enable the
    // button after a beat so a slow dispatch can't lock the dialog out.
    if (resendTimer.current !== null) window.clearTimeout(resendTimer.current);
    resendTimer.current = window.setTimeout(() => {
      resendTimer.current = null;
      setResending(false);
    }, 3_000);
  };

  const armed = props.dualFactorArmed === true;

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
      footerStart={
        armed && props.onResend ? (
          <button type="button" className={BTN_SECONDARY} onClick={resend} disabled={resending || props.busy}>
            <span className="inline-flex items-center gap-1.5">
              <RefreshCw size={14} className={resending ? "animate-spin" : undefined} />
              {t("dashboard.connect.passwordResend")}
            </span>
          </button>
        ) : undefined
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
        <p className="mt-2 text-[length:var(--text-xs)] text-text-muted" data-testid="password-prompt-hint">
          {armed
            ? t("dashboard.connect.passwordPromptArmedHint")
            : t("dashboard.connect.passwordDualFactorHint")}
        </p>
        {!armed && (
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
        )}
        {armed && props.onDisableAuto && (
          // Escape hatch: a host is armed automatically on the first failed
          // empty-password connect, and without this it stayed armed forever
          // (every click fired a background SSH attempt).
          <button
            type="button"
            onClick={props.onDisableAuto}
            disabled={props.busy}
            className="mt-3 text-[length:var(--text-xs)] text-text-muted underline decoration-dotted hover:text-text-primary transition-colors"
          >
            {t("dashboard.connect.passwordDisableAuto")}
          </button>
        )}
      </form>
    </ModalShell>
  );
}
