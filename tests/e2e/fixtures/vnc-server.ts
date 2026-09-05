import { createServer, type Socket } from "node:net";

/** Minimal real RFB 3.8 peer: deterministic pixels, no authentication. */
export async function startVncFixture() {
    const sockets = new Set<Socket>();
    let keyEvents = 0;
    const server = createServer(socket => {
        sockets.add(socket);
        socket.on("close", () => sockets.delete(socket));
        socket.on("error", () => {});
        let buffer = Buffer.alloc(0);
        let phase = 0;
        let sentFrame = false;
        let redShift = 16, greenShift = 8, blueShift = 0, bigEndian = false;
        socket.write("RFB 003.008\n");
        socket.on("data", data => {
            buffer = Buffer.concat([buffer, data]);
            while (buffer.length) {
                if (phase === 0) {
                    if (buffer.length < 12) return;
                    buffer = buffer.subarray(12); phase = 1; socket.write(Buffer.from([1, 1]));
                } else if (phase === 1) {
                    buffer = buffer.subarray(1); phase = 2; socket.write(Buffer.alloc(4));
                } else if (phase === 2) {
                    buffer = buffer.subarray(1); phase = 3;
                    const name = Buffer.from("anySSH VNC fixture");
                    const init = Buffer.alloc(24);
                    init.writeUInt16BE(64, 0); init.writeUInt16BE(64, 2);
                    init[4] = 32; init[5] = 24; init[7] = 1;
                    init.writeUInt16BE(255, 8); init.writeUInt16BE(255, 10); init.writeUInt16BE(255, 12);
                    init[14] = 16; init[15] = 8; init[16] = 0; init.writeUInt32BE(name.length, 20);
                    socket.write(Buffer.concat([init, name]));
                } else {
                    const type = buffer[0];
                    let length: number;
                    if (type === 0) length = 20;
                    else if (type === 2) { if (buffer.length < 4) return; length = 4 + buffer.readUInt16BE(2) * 4; }
                    else if (type === 3) length = 10;
                    else if (type === 4) length = 8;
                    else if (type === 5) length = 6;
                    else if (type === 6) { if (buffer.length < 8) return; length = 8 + buffer.readUInt32BE(4); }
                    else { socket.destroy(); return; }
                    if (buffer.length < length) return;
                    if (type === 0) { redShift = buffer[14]; greenShift = buffer[15]; blueShift = buffer[16]; bigEndian = buffer[6] !== 0; }
                    if (type === 4) keyEvents++;
                    if (type === 3 && !sentFrame) {
                        sentFrame = true;
                        const frame = Buffer.alloc(16 + 64 * 64 * 4);
                        frame.writeUInt16BE(1, 2); frame.writeUInt16BE(64, 8); frame.writeUInt16BE(64, 10);
                        for (let i = 16; i < frame.length; i += 4) {
                            const pixel = ((32 << redShift) | (96 << greenShift) | (160 << blueShift)) >>> 0;
                            if (bigEndian) frame.writeUInt32BE(pixel, i); else frame.writeUInt32LE(pixel, i);
                        }
                        socket.write(frame);
                    }
                    buffer = buffer.subarray(length);
                }
            }
        });
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    return {
        port: (server.address() as { port: number }).port,
        keyEvents: () => keyEvents,
        close: async () => { for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); },
    };
}
