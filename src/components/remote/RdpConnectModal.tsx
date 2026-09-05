import { ProtocolConnectModal } from "../dashboard/ProtocolConnectModal";
import type { SavedHost } from "../../types";
export function RdpConnectModal(props: { onClose: () => void; initial?: SavedHost }) {
  return <ProtocolConnectModal kind="rdp" {...props} />;
}
