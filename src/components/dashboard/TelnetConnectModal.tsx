import { ProtocolConnectModal } from "./ProtocolConnectModal";
import type { SavedHost } from "../../types";
export function TelnetConnectModal(props: { onClose: () => void; initial?: SavedHost }) {
  return <ProtocolConnectModal kind="telnet" {...props} />;
}
