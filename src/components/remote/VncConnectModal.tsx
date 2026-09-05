import { ProtocolConnectModal } from "../dashboard/ProtocolConnectModal";
import type { SavedHost } from "../../types";
export function VncConnectModal(props: { onClose: () => void; initial?: SavedHost }) {
  return <ProtocolConnectModal kind="vnc" {...props} />;
}
