import { useEffect, useRef, useState } from "react";
import { Cable, Monitor, Plus, RefreshCw, Trash2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ModalShell, BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY } from "../shared/ModalShell";
import { CustomSelect } from "../shared/CustomSelect";
import { useTranslation } from "../../i18n";
import { useSessionStore } from "../../stores/session-store";
import { useTabStore } from "../../stores/tab-store";
import { useGroupsStore } from "../../stores/groups-store";
import { useHostsStore } from "../../stores/hosts-store";
import { TERMINAL_ENCODINGS, useSettingsStore } from "../../stores/settings-store";
import { buildProtocolHost, protocolParams, type ProtocolHostKind } from "../../lib/protocol-hosts";
import type { SavedHost, StoredCredential } from "../../types";

interface Props { kind: ProtocolHostKind; initial?: SavedHost; onClose: () => void }
interface ScriptStep { expect: string; send: string }
interface PortInfo { path: string; manufacturer?: string; product?: string }
interface Certificate { fingerprint: string; trustedFingerprint: string | null }
const INPUT = "w-full min-w-0 px-3 py-2 rounded-lg bg-bg-surface border border-border text-[length:var(--text-sm)] text-text-primary placeholder:text-text-muted outline-none focus:border-border-focus focus:ring-2 focus:ring-ring disabled:opacity-60";

export function ProtocolConnectModal({ kind, initial, onClose }: Props) {
  const { t } = useTranslation();
  const defaults = useSettingsStore.getState();
  const [parsed] = useState(() => { try { return initial ? protocolParams(initial) : {}; } catch { return {}; } });
  const [host, setHost] = useState(initial?.host ?? "");
  const [port, setPort] = useState(String(initial?.port || (kind === "vnc" ? 5900 : kind === "rdp" ? 3389 : 23)));
  const [label, setLabel] = useState(initial?.label ?? "");
  const [username, setUsername] = useState(initial?.username ?? "");
  const [password, setPassword] = useState("");
  const [encoding, setEncoding] = useState(String(parsed.encoding ?? defaults.terminalEncoding));
  const [baud, setBaud] = useState(String(parsed.baud ?? 115200));
  const [dataBits, setDataBits] = useState(String(parsed.dataBits ?? 8));
  const [stopBits, setStopBits] = useState(String(parsed.stopBits ?? 1));
  const [parity, setParity] = useState(String(parsed.parity ?? "none"));
  const [flow, setFlow] = useState(String(parsed.flowControl ?? "none"));
  const [shell, setShell] = useState(String(parsed.shell ?? ""));
  const [directory, setDirectory] = useState(String(parsed.startDirectory ?? ""));
  const [group, setGroup] = useState(initial?.group_id ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [remember, setRemember] = useState(Boolean(initial));
  const [steps, setSteps] = useState<ScriptStep[]>((parsed.loginScript as ScriptStep[] | undefined) ?? []);
  const [ports, setPorts] = useState<PortInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [loadingScript, setLoadingScript] = useState(Boolean(parsed.scriptCredentialId));
  const [error, setError] = useState("");
  const [certificate, setCertificate] = useState<Certificate | null>(null);
  const alive = useRef(true);
  const submitting = useRef(false);
  const groups = useGroupsStore(s => s.groups);
  const graph = kind === "vnc" || kind === "rdp";
  const network = kind !== "local" && kind !== "serial";
  const title = kind === "local" ? t("dashboard.action.localTerminal") : t(`dashboard.${kind}.title`);
  const messageOf = (err: unknown) => err && typeof err === "object" && "message" in err ? String(err.message) : String(err);
  const close = () => { alive.current = false; onClose(); };

  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    const refresh = async () => {
      try {
        const result = await invoke<PortInfo[]>("serial_list_ports");
        if (!cancelled) setPorts(result);
      } catch (err) { if (!cancelled) setError(messageOf(err)); }
    };
    if (kind === "serial") {
      void refresh();
      void (async () => {
        const un = await listen("serial:ports-changed", () => void refresh());
        if (cancelled) { un(); return; }
        unlisten = un;
        await invoke("serial_start_hotplug");
      })().catch(err => { if (!cancelled) setError(messageOf(err)); });
    }
    if (initial && parsed.scriptCredentialId) {
      void invoke<StoredCredential>("vault_get_credential", { hostId: initial.id }).then(credential => {
        if (cancelled) return;
        if (credential.type !== "Password") throw new Error(t("dashboard.protocol.scriptUnavailable"));
        const script: unknown = JSON.parse(credential.password);
        if (!Array.isArray(script) || !script.every(s => typeof s.expect === "string" && typeof s.send === "string")) throw new Error(t("dashboard.protocol.scriptUnavailable"));
        setSteps(script);
        setLoadingScript(false);
      }).catch(err => { if (!cancelled) setError(messageOf(err)); });
    }
    return () => { cancelled = true; alive.current = false; unlisten?.(); };
  }, [kind, initial, parsed, t]);

  function build(): SavedHost {
    if (kind !== "local" && !host.trim()) throw new Error(t("host.validation.hostRequired"));
    if (network && (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)) throw new Error(t("host.validation.portRange"));
    if (kind === "serial" && (!/^\d+$/.test(baud) || Number(baud) < 1 || Number(baud) > 4_000_000)) throw new Error(t("dashboard.protocol.invalidBaud"));
    const destination = kind === "local" ? "localhost" : network ? host.trim().replace(/^\[(.*)\]$/, "$1") : host.trim();
    const portNum = network ? Number(port) : 0;
    const params = kind === "telnet"
      ? { kind, host: destination, port: portNum, encoding, loginScript: steps.filter(s => s.expect || s.send) }
      : kind === "serial"
        ? { kind, port: destination, baud: Number(baud), encoding, dataBits: Number(dataBits), stopBits: Number(stopBits), parity, flowControl: flow }
        : kind === "local"
          ? { kind, shell: shell || null, startDirectory: directory || null, encoding }
          : { host: destination, port: portNum, username: username.trim() };
    const name = label.trim() || (kind === "local" ? title : kind === "serial" ? `${destination} @ ${baud}` : `${kind}://${destination}:${portNum}`);
    const fresh = buildProtocolHost(kind, name, destination, portNum, params, username.trim());
    return { ...initial, ...fresh, id: initial?.id ?? fresh.id, created_at: initial?.created_at ?? fresh.created_at,
      color: initial?.color ?? null, environment: initial?.environment ?? null, terminal_theme: initial?.terminal_theme ?? null,
      backspace_sends_ctrl_h: initial?.backspace_sends_ctrl_h ?? null, force_session_log: initial?.force_session_log ?? false,
      group_id: group || null, notes: notes.trim() || null, terminal_encoding: graph ? null : encoding,
      last_connected_at: initial?.last_connected_at ?? null, connection_count: initial?.connection_count ?? null };
  }

  async function submit(connect: boolean, trust = false) {
    if (submitting.current || loadingScript) return;
    submitting.current = true; setBusy(true); setError("");
    try {
      const bookmark = build();
      if (!connect) {
        await useHostsStore.getState().saveHost(bookmark);
        if (alive.current) close();
        return;
      }
      if (kind === "rdp") {
        if (!username.trim()) throw new Error(t("host.validation.usernameRequired"));
        if (trust && certificate) await invoke("rd_trust_certificate", { host: bookmark.host, port: bookmark.port, fingerprint: certificate.fingerprint });
        const cert = await invoke<Certificate>("rd_inspect_certificate", { host: bookmark.host, port: bookmark.port });
        if (!alive.current) return;
        if (cert.fingerprint !== cert.trustedFingerprint) { setCertificate(cert); return; }
        setCertificate(null);
      }
      if (!alive.current) return;
      if (graph) {
        const endpoint = await invoke<{ token: string; wsUrl: string }>(kind === "vnc" ? "vnc_open" : "rd_open", { host: bookmark.host, port: bookmark.port });
        if (!alive.current) { await invoke(kind === "vnc" ? "vnc_close" : "rd_close", { token: endpoint.token }); return; }
        const savedHost = remember ? bookmark : undefined;
        if (kind === "vnc") useTabStore.getState().addTab({ type: "vnc", id: endpoint.token, label: bookmark.label, wsUrl: endpoint.wsUrl, savedHost });
        else useTabStore.getState().addTab({ type: "rdp", id: endpoint.token, label: bookmark.label, wsUrl: endpoint.wsUrl, savedHost,
          destination: `${bookmark.host.includes(":") ? `[${bookmark.host.replace(/^\[|\]$/g, "")}]` : bookmark.host}:${bookmark.port}`, username: username.trim(), password });
      } else {
        const id = await invoke<string>("term_open", { params: JSON.parse(bookmark.params_json!), cols: 80, rows: 24 });
        if (!alive.current) { await invoke("term_close", { sessionId: id }); return; }
        if (remember) {
          try { await useHostsStore.getState().saveHost(bookmark); }
          catch (err) { await invoke("term_close", { sessionId: id }); throw err; }
          if (!alive.current) { await invoke("term_close", { sessionId: id }); return; }
          void useHostsStore.getState().recordConnection(bookmark.id);
        }
        useSessionStore.getState().addSession(id, { host: bookmark.host, port: bookmark.port, username: bookmark.username, label: bookmark.label,
          auth_method: { type: "password", password: "" }, terminal_encoding: encoding, terminal_theme: bookmark.terminal_theme ?? undefined,
          backspace_sends_ctrl_h: bookmark.backspace_sends_ctrl_h ?? undefined }, kind);
        useTabStore.getState().addTab({ type: "terminal", id, label: bookmark.label });
      }
      close();
    } catch (err) { if (alive.current) setError(messageOf(err)); }
    finally { submitting.current = false; if (alive.current) setBusy(false); }
  }

  function field(text: string, input: React.ReactNode) {
    return <label className="flex flex-col gap-1.5 min-w-0 text-[length:var(--text-xs)] font-medium text-text-secondary">{text}{input}</label>;
  }
  return <ModalShell open onClose={close} title={title} icon={kind === "serial" ? Cable : Monitor} maxWidth="lg" scrollable testId={`${kind}-connect-modal`}
    footerStart={<button data-testid="protocol-save-button" type="button" disabled={busy || loadingScript} onClick={() => void submit(false)} className={BTN_SECONDARY}>{t("common.save")}</button>}
    footer={<><button type="button" onClick={close} className={BTN_GHOST}>{t("common.cancel")}</button><button type="submit" form={`${kind}-connect-form`} disabled={busy || loadingScript || certificate !== null} data-testid={`${kind}-connect-button`} className={BTN_PRIMARY}>{busy ? t("dashboard.connect.connecting") : t("dashboard.protocol.connect")}</button></>}>
    <form id={`${kind}-connect-form`} onSubmit={event => { event.preventDefault(); void submit(true); }} className="flex flex-col gap-4">
      {error && <p role="alert" className="rounded-lg bg-status-error/10 px-3 py-2 text-status-error text-[length:var(--text-sm)] break-words">{error}</p>}
      {certificate && <div role="alert" className="rounded-lg border border-border p-3 space-y-3 text-[length:var(--text-sm)]">
        <p>{t(certificate.trustedFingerprint ? "dashboard.protocol.certificateChanged" : "dashboard.protocol.certificateFirst")}</p>
        <p className="font-mono break-all select-text">SHA-256: {certificate.fingerprint}</p>
        {certificate.trustedFingerprint && <p className="font-mono break-all text-text-muted">{t("dashboard.protocol.previousCertificate")}: {certificate.trustedFingerprint}</p>}
        <button type="button" disabled={busy} onClick={() => void submit(true, true)} className={BTN_PRIMARY}>{t("dashboard.protocol.trustCertificate")}</button>
      </div>}
      <fieldset disabled={busy || certificate !== null} className="flex flex-col gap-4 min-w-0">
        {kind !== "local" && <div className={network ? "grid grid-cols-[minmax(0,1fr)_6rem] gap-3" : "flex flex-col gap-3"}>
          {field(t(kind === "serial" ? "dashboard.protocol.device" : "dashboard.protocol.address"), <input autoFocus className={INPUT} value={host} onChange={e => setHost(e.target.value)} data-testid={`${kind}-host-input`} placeholder={kind === "serial" ? "/dev/ttyUSB0 / COM3" : t(`dashboard.${kind}.hostPlaceholder`)} />)}
          {network && field(t("dashboard.protocol.port"), <input className={INPUT} inputMode="numeric" value={port} onChange={e => setPort(e.target.value)} data-testid={`${kind}-port-input`} />)}
        </div>}
        {kind === "serial" && <>
          <div className="flex gap-2 items-center"><CustomSelect value={host} onChange={setHost} placeholder={t("dashboard.serial.noPorts")} options={ports.map(p => ({ value: p.path, label: [p.path, p.manufacturer, p.product].filter(Boolean).join(" · ") }))} />
            <button type="button" aria-label={t("dashboard.serial.refresh")} className={BTN_GHOST} onClick={() => void invoke<PortInfo[]>("serial_list_ports").then(setPorts).catch(err => setError(messageOf(err)))}><RefreshCw size={15} /></button></div>
          <div className="grid grid-cols-2 gap-3">{field(t("dashboard.protocol.baud"), <input className={INPUT} inputMode="numeric" value={baud} onChange={e => setBaud(e.target.value)} />)}
            {field(t("dashboard.protocol.dataBits"), <CustomSelect value={dataBits} onChange={setDataBits} options={[5,6,7,8].map(n => ({ value: String(n), label: String(n) }))} />)}
            {field(t("dashboard.protocol.stopBits"), <CustomSelect value={stopBits} onChange={setStopBits} options={[1,2].map(n => ({ value: String(n), label: String(n) }))} />)}
            {field(t("dashboard.protocol.parity"), <CustomSelect value={parity} onChange={setParity} options={["none","even","odd"].map(value => ({ value, label: t(`dashboard.protocol.${value}`) }))} />)}
            {field(t("dashboard.protocol.flow"), <CustomSelect value={flow} onChange={setFlow} options={["none","hardware","software"].map(value => ({ value, label: t(`dashboard.protocol.${value}`) }))} />)}
          </div>
        </>}
        {kind === "local" && <>{field(t("dashboard.protocol.shell"), <input autoFocus className={INPUT} value={shell} onChange={e => setShell(e.target.value)} placeholder={t("dashboard.protocol.systemDefault")} />)}{field(t("dashboard.protocol.directory"), <input className={INPUT} value={directory} onChange={e => setDirectory(e.target.value)} />)}</>}
        {kind === "rdp" && <>{field(t("dashboard.protocol.username"), <input className={INPUT} value={username} onChange={e => setUsername(e.target.value)} placeholder={t("dashboard.rdp.usernamePlaceholder")} data-testid="rdp-username-input" />)}{field(t("dashboard.protocol.password"), <input type="password" autoComplete="off" className={INPUT} value={password} onChange={e => setPassword(e.target.value)} data-testid="rdp-password-input" />)}</>}
        {!graph && field(t("dashboard.telnet.encoding"), <CustomSelect data-testid={`${kind}-encoding-select`} aria-label={t("dashboard.telnet.encoding")} value={encoding} onChange={setEncoding} options={TERMINAL_ENCODINGS.map(e => ({ value: e.value, label: e.label }))} />)}
        {kind === "telnet" && <section className="space-y-2"><div className="flex justify-between gap-2 items-center"><span className="text-[length:var(--text-xs)] text-text-secondary">{t("dashboard.telnet.scriptTitle")}</span><button type="button" className={BTN_GHOST} data-testid="telnet-add-step" disabled={steps.length >= 100} onClick={() => setSteps(s => [...s, { expect: "", send: "" }])}><span className="flex items-center gap-1"><Plus size={13} />{t("dashboard.telnet.addStep")}</span></button></div>
          <p className="text-[length:var(--text-xs)] text-text-muted">{t("dashboard.protocol.scriptProtected")}</p>
          {steps.map((step, i) => <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2">
            {field(t("dashboard.protocol.expect"), <input className={INPUT} value={step.expect} onChange={e => setSteps(s => s.map((v,n) => n === i ? { ...v, expect: e.target.value } : v))} />)}
            {field(t("dashboard.protocol.send"), <input type="password" autoComplete="off" className={INPUT} value={step.send} onChange={e => setSteps(s => s.map((v,n) => n === i ? { ...v, send: e.target.value } : v))} />)}
            <button type="button" className="p-2 rounded text-text-muted hover:text-status-error" aria-label={t("common.delete")} onClick={() => setSteps(s => s.filter((_, n) => n !== i))}><Trash2 size={15} /></button>
          </div>)}
        </section>}
        <details open={Boolean(initial)} className="border-t border-border pt-3"><summary className="cursor-pointer text-[length:var(--text-sm)] text-text-secondary">{t("dashboard.protocol.bookmark")}</summary><div className="mt-3 space-y-3">
          {field(t("dashboard.protocol.label"), <input className={INPUT} value={label} onChange={e => setLabel(e.target.value)} data-testid="protocol-label" />)}
          {field(t("dashboard.protocol.group"), <CustomSelect value={group} onChange={setGroup} options={[{ value: "", label: t("dashboard.protocol.noGroup") }, ...groups.map(g => ({ value: g.id, label: g.name }))]} />)}
          {field(t("dashboard.protocol.notes"), <textarea className={INPUT} value={notes} onChange={e => setNotes(e.target.value)} rows={2} />)}
        </div></details>
        <label className="flex items-center gap-2 text-[length:var(--text-sm)] text-text-secondary"><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />{t("dashboard.protocol.saveAfterConnect")}</label>
      </fieldset>
    </form>
  </ModalShell>;
}
