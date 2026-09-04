// Interactive password prompt (PuTTY/Xshell-style) — the path where the host
// form has no password typed and the vault holds no credential.
//
// Regression coverage for the dual-factor bastion fixes (v0.14.20–v0.14.22):
// the password typed into the prompt must reach the backend (it used to be
// swallowed and the prompt re-opened in an infinite loop), and an EMPTY
// submit must not be blocked — connecting once with an empty password is the
// documented way to trigger SMS delivery on dual-factor bastions, so the
// backend failure that follows carries the "dual-factor trigger sent"
// guidance instead of a bare rejection.

import { expect } from "chai";
import { resetApp } from "../helpers/reset.js";
import { waitForDashboard } from "../helpers/dashboard.js";
import { clickConnect, openNewHostModal, waitForModalClosed } from "../helpers/host.js";
import {
    runCommand,
    waitForAnyTerminal,
    waitForTerminalText,
} from "../helpers/terminal.js";

const SSHD_PASS_HOST = process.env.SSHD_PASS_HOST ?? "sshd-pass";
const SSHD_PASS_PORT = Number(process.env.SSHD_PASS_PORT ?? 2222);
const SSH_USER = process.env.SSH_USER ?? "testuser";
const SSH_PASS = process.env.SSH_PASS ?? "testpass";

/** Fill the new-host form WITHOUT a password, so Connect opens the prompt. */
async function fillNoPasswordForm(label: string): Promise<void> {
    // Auth type defaults to "password" — just fill the identity fields.
    for (const [testid, value] of [
        ["host-modal-label", label],
        ["host-modal-host", SSHD_PASS_HOST],
        ["host-modal-port", String(SSHD_PASS_PORT)],
        ["host-modal-username", SSH_USER],
    ] as const) {
        const el = await $(`[data-testid='${testid}']`);
        await el.waitForExist({ timeout: 5_000 });
        await el.click();
        await el.setValue(value);
    }
}

async function waitForPasswordPrompt(): Promise<void> {
    const modal = await $("[data-testid='password-prompt-modal']");
    await modal.waitForDisplayed({ timeout: 5_000 });
}

/** Type a password (possibly empty) and click the prompt's Connect button. */
async function submitPromptPassword(value: string): Promise<void> {
    const input = await $("#password-prompt-input");
    await input.setValue(value);
    // Footer buttons: show/hide eye lives in the body; the footer is
    // [Cancel, Connect] — the primary submit is the last button in the panel.
    const buttons = await $$("[data-testid='password-prompt-modal'] button");
    await buttons[buttons.length - 1].click();
}

/** The prompt must stay closed after submit — if it re-opens, the submitted
 *  password never reached the backend (the pre-v0.14.22 infinite loop). */
async function assertPromptStaysClosed(): Promise<void> {
    await browser.waitUntil(
        async () => !(await (await $("[data-testid='password-prompt-modal']")).isExisting()),
        { timeout: 5_000, timeoutMsg: "password prompt re-opened after submit" },
    );
}

async function waitForHostModalError(): Promise<string> {
    const err = await $("[data-testid='host-modal-error']");
    await err.waitForDisplayed({ timeout: 30_000 });
    return err.getText();
}

describe("interactive password prompt", () => {
    beforeEach(async () => {
        await resetApp();
        await waitForDashboard();
    });

    it("opens on connect with no saved password, and an EMPTY submit triggers the dual-factor attempt", async () => {
        await openNewHostModal();
        await fillNoPasswordForm("prompt-empty-trigger");
        await clickConnect();

        await waitForPasswordPrompt();

        // The dual-factor hint is part of the prompt's guidance.
        const hint = await $("[data-testid='password-prompt-hint']");
        await hint.waitForDisplayed({ timeout: 5_000 });

        await submitPromptPassword("");

        // sshd-pass rejects the empty credential, but the failure must be the
        // dual-factor flavour: strategy B ran and answered the trigger prompt
        // with the non-empty placeholder.
        const text = await waitForHostModalError();
        expect(text).to.include("dual-factor trigger sent");

        // Prompt closed; host modal stays open with the error.
        await assertPromptStaysClosed();
        const modal = await $("[data-testid='host-modal']");
        expect(await modal.isDisplayed()).to.equal(true);
    });

    it("passes a typed wrong password to the backend exactly once (no re-prompt loop)", async () => {
        await openNewHostModal();
        await fillNoPasswordForm("prompt-wrong-pass");
        await clickConnect();

        await waitForPasswordPrompt();
        await submitPromptPassword("definitely-not-the-password");

        const text = await waitForHostModalError();
        expect(text).to.include("server rejected credentials");

        // Regression: the submitted password used to be discarded and the
        // prompt re-opened forever. It must stay closed with the error shown.
        await assertPromptStaysClosed();
    });

    it("connects when the correct password is typed into the prompt", async () => {
        await openNewHostModal();
        await fillNoPasswordForm("prompt-correct-pass");
        await clickConnect();

        await waitForPasswordPrompt();
        await submitPromptPassword(SSH_PASS);

        // Both modals close and the terminal mounts — proof the prompt's
        // password reached russh and authenticated.
        await waitForModalClosed();
        const sessionId = await waitForAnyTerminal();
        await waitForTerminalText(sessionId, ":~$", { timeoutMs: 20_000 });

        const sentinel = "anyssh_e2e_" + Date.now();
        await runCommand(sessionId, `echo ${sentinel}`, sentinel, 10_000);
    });
});
