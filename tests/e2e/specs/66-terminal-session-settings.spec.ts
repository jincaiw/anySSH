// Terminal → Session settings: character encoding dropdown and the editable
// TERM-type combobox — defaults, option picking, hand-typed custom values,
// invalid-input rejection, and persistence across an app restart.

import { expect } from "chai";
import { relaunchApp, resetApp } from "../helpers/reset.js";

async function openTerminalSettings(): Promise<void> {
    const nav = await $("[aria-label='Settings']");
    await nav.waitForClickable({ timeout: 10_000 });
    await nav.click();
    const terminalNav = await $("[data-testid='settings-nav-terminal']");
    await terminalNav.waitForClickable({ timeout: 10_000 });
    await terminalNav.click();
    await (await $("[data-testid='s-fontsize']")).waitForDisplayed({ timeout: 10_000 });
}

/** Open a CustomSelect by trigger test id and pick an option by its value. */
async function pickFromSelect(testid: string, optionValue: string): Promise<void> {
    const trigger = await $(`[data-testid='${testid}']`);
    await trigger.waitForClickable({ timeout: 10_000 });
    await trigger.click();
    const option = await $(`[data-testid='${testid}-option-${optionValue}']`);
    await option.waitForClickable({ timeout: 10_000 });
    await option.click();
}

async function selectedValue(testid: string): Promise<string | null> {
    return (await $(`[data-testid='${testid}']`)).getAttribute("data-value");
}

/**
 * Commit a hand-typed value in the editable TERM combobox: focus the input,
 * replace its contents, press Enter. The dropdown opens on focus and filters
 * as we type; with no matching preset, Enter commits the typed value.
 */
async function typeTermValue(value: string): Promise<void> {
    const input = await $("input[data-testid='s-termtype']");
    await input.waitForClickable({ timeout: 10_000 });
    await input.click();
    await input.setValue(value);
    await browser.keys("Enter");
}

describe("terminal session settings", () => {
    beforeEach(async () => {
        await resetApp();
    });

    it("encoding defaults to UTF-8, accepts GBK, and persists", async () => {
        await openTerminalSettings();

        expect(await selectedValue("s-encoding")).to.equal("utf-8");

        await pickFromSelect("s-encoding", "gbk");
        await browser.waitUntil(
            async () => (await selectedValue("s-encoding")) === "gbk",
            { timeout: 5_000, timeoutMsg: "encoding did not switch to gbk" },
        );

        await relaunchApp();
        await openTerminalSettings();
        expect(await selectedValue("s-encoding")).to.equal("gbk");
    });

    it("terminal type defaults to xterm-256color and persists a preset change", async () => {
        await openTerminalSettings();

        expect(await selectedValue("s-termtype")).to.equal("xterm-256color");

        await pickFromSelect("s-termtype", "vt100");
        await browser.waitUntil(
            async () => (await selectedValue("s-termtype")) === "vt100",
            { timeout: 5_000, timeoutMsg: "terminal type did not switch to vt100" },
        );

        await relaunchApp();
        await openTerminalSettings();
        expect(await selectedValue("s-termtype")).to.equal("vt100");
    });

    it("terminal type accepts a hand-typed custom TERM value", async () => {
        await openTerminalSettings();

        await typeTermValue("screen.xterm");
        await browser.waitUntil(
            async () => (await selectedValue("s-termtype")) === "screen.xterm",
            { timeout: 5_000, timeoutMsg: "custom TERM value was not committed" },
        );
    });

    it("terminal type rejects invalid input and reverts", async () => {
        await openTerminalSettings();

        // A value with a space fails the TERM whitelist; Enter must revert
        // the input to the committed value instead of storing it.
        await typeTermValue("bad term!");
        await browser.pause(300);
        expect(await selectedValue("s-termtype")).to.equal("xterm-256color");

        // The visible input shows the reverted value too.
        const input = await $("input[data-testid='s-termtype']");
        expect(await input.getValue()).to.equal("xterm-256color");
    });
});
