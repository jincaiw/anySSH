import { ProtocolConnectModal } from "./ProtocolConnectModal";
import type { SavedHost } from "../../types";
export function SerialConnectModal(props: { onClose: () => void; initial?: SavedHost }) {
  return <ProtocolConnectModal kind="serial" {...props} />;
}
