import { expect } from "chai";
import { resetApp } from "../helpers/reset.js";
import { waitForDashboard } from "../helpers/dashboard.js";

describe("dashboard connection toolbar", () => {
    before(async () => { await resetApp(); await waitForDashboard(); });
    after(async () => { await browser.setWindowSize(1200, 800); });

    it("keeps every connection accessible without overlap at minimum desktop width and in keyboard order", async () => {
        const ids = ["local-terminal", "host", "telnet", "rdp", "vnc", "serial", "s3"];
        for (const width of [1200, 800]) {
            await browser.setWindowSize(width, 800);
            for (const expanded of [true, false]) {
                const sidebar = await $("[data-sidebar-expanded]");
                if ((await sidebar.getAttribute("data-sidebar-expanded")) !== String(expanded)) {
                    await (await $(expanded ? "button[aria-label='Expand']" : "button[aria-label='Collapse']")).click();
                }
                await browser.waitUntil(async () => {
                    const bounds = await browser.execute((names: string[]) => names.map(name => {
                        const el = document.querySelector<HTMLElement>(`[data-testid="new-${name}-button"]`)!;
                        const r = el.getBoundingClientRect();
                        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, fits: el.scrollWidth <= el.clientWidth, viewport: innerWidth };
                    }), ids);
                    return bounds.every((r, i) => r.left >= 0 && r.right <= r.viewport && r.fits &&
                        (i === 0 || r.top >= bounds[i - 1].bottom - 1 || r.left >= bounds[i - 1].right - 1));
                }, { timeout: 5000, timeoutMsg: "Connection buttons overflow or overlap" });
                const labels = await browser.execute((names: string[]) => names.map(name =>
                    document.querySelector(`[data-testid="new-${name}-button"]`)!.textContent?.trim()), ids);
                expect(labels).to.deep.equal(["Local Terminal", "SSH", "Telnet", "RDP", "VNC", "Serial", "Object Storage"]);
                await (await $("[data-testid='host-search']")).click();
                for (const id of ids) {
                    await browser.keys(["Tab"]);
                    expect(await browser.execute(() => document.activeElement?.getAttribute("data-testid"))).to.equal(`new-${id}-button`);
                }
            }
        }
    });
});
