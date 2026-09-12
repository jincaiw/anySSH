#!/usr/bin/env python3
"""Minimal telnet server that behaves like a passive network device.

Purpose: verify anySSH's window-size (NAWS) handling without any real gear.

Two things make it a fair test:

* It **never sends `IAC DO NAWS` on its own** — that is the whole point, since
  plenty of switches and embedded telnetd never initiate the option. RFC 1073
  lets either side start, so the client is expected to offer it.
* It answers `WILL NAWS` with `DO NAWS`, i.e. it is a NAWS-capable but
  non-initiating device. A client that merely replies to `DO NAWS` will work
  here too, which is why the server also reports whether it saw the client
  offer the option *before* being asked.

Everything received is printed with a timestamp, and the negotiated size is
echoed back into the terminal so a resize is visible as it happens.

    python3 tests/manual/telnet_naws_fixture.py [--port 2323]
"""

import argparse
import datetime
import socket
import threading

IAC, DONT, DO, WONT, WILL, SB, SE = 255, 254, 253, 252, 251, 250, 240
OPT_NAMES = {0: "BINARY", 1: "ECHO", 3: "SGA", 24: "TTYPE", 31: "NAWS", 34: "LINEMODE"}

# Parser states
DATA, IAC_SEEN, CMD_OPT, SB_OPT, SB_DATA, SB_IAC = range(6)


def log(msg: str) -> None:
    print(f"{datetime.datetime.now():%H:%M:%S} {msg}", flush=True)


def opt_name(o: int) -> str:
    return OPT_NAMES.get(o, f"opt{o}")


def handle(conn: socket.socket, addr) -> None:
    def send(b: bytes) -> None:
        try:
            conn.sendall(b)
        except OSError:
            pass

    log(f"connection from {addr[0]}:{addr[1]}")
    send(
        b"\r\nanySSH NAWS fixture - passive device\r\n"
        b"this server never sends DO NAWS first; the client must offer it.\r\n"
    )
    send(b"resize the terminal window and the new size appears below.\r\n")

    state = DATA
    cmd = 0
    sub = bytearray()
    offered_before_ask = False
    asked = False

    while True:
        try:
            data = conn.recv(4096)
        except OSError:
            break
        if not data:
            break

        for b in data:
            if state == DATA:
                if b == IAC:
                    state = IAC_SEEN
            elif state == IAC_SEEN:
                if b == IAC:
                    state = DATA               # escaped 0xFF, a literal byte
                elif b == SB:
                    state = SB_OPT
                elif b in (WILL, WONT, DO, DONT):
                    cmd, state = b, CMD_OPT
                else:
                    state = DATA               # other two-byte commands
            elif state == CMD_OPT:
                if cmd == WILL and b == 31:    # client offers to report size
                    if not asked:
                        offered_before_ask = True
                    log("client -> WILL NAWS (its own initiative)" if offered_before_ask
                        else "client -> WILL NAWS")
                    send(bytes([IAC, DO, 31]))
                    log("server -> DO NAWS")
                elif cmd == WILL:
                    log(f"client -> WILL {opt_name(b)} ; server -> DONT")
                    send(bytes([IAC, DONT, b]))
                elif cmd == DO:
                    log(f"client -> DO {opt_name(b)} ; server -> WONT")
                    send(bytes([IAC, WONT, b]))
                else:
                    log(f"client -> {cmd} {opt_name(b)}")
                state = DATA
            elif state == SB_OPT:
                sub = bytearray([b])
                state = SB_DATA
            elif state == SB_DATA:
                if b == IAC:
                    state = SB_IAC
                else:
                    sub.append(b)
            elif state == SB_IAC:
                if b == SE:
                    if sub[:1] == bytes([31]):  # NAWS payload: cols, rows (16-bit BE)
                        if len(sub) >= 5:
                            cols = (sub[1] << 8) | sub[2]
                            rows = (sub[3] << 8) | sub[4]
                            log(f"client -> SB NAWS cols={cols} rows={rows}")
                            send(f"\r\n[device] window = {cols}x{rows}\r\n".encode())
                        else:
                            log(f"client -> SB NAWS malformed ({len(sub)} bytes)")
                    else:
                        log(f"client -> SB {opt_name(sub[0])} {bytes(sub[1:])!r}")
                    state = DATA
                elif b == IAC:
                    sub.append(255)
                    state = SB_DATA
                else:
                    state = SB_DATA

    log(f"disconnect {addr[0]}:{addr[1]}")
    conn.close()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=2323)
    args = ap.parse_args()

    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind((args.host, args.port))
    srv.listen(8)
    log(f"listening on {args.host}:{args.port} (Ctrl-C to stop)")
    while True:
        conn, addr = srv.accept()
        threading.Thread(target=handle, args=(conn, addr), daemon=True).start()


if __name__ == "__main__":
    main()
