// Recent-connections helpers.

/** Wait for a recent-connection chip with the given label to appear. */
export async function waitForRecent(
    label: string,
    timeoutMs = 10_000,
): Promise<WebdriverIO.Element> {
    const el = await $(`[data-recent-label='${label}']`);
    await el.waitForExist({ timeout: timeoutMs });
    // wdio ^9.31 types `await $()` as ChainablePromiseElement; at runtime the
    // await has already resolved to a concrete element.
    return el as unknown as WebdriverIO.Element;
}

/** Count visible recent-connection chips. */
export async function recentCount(): Promise<number> {
    const items = await $$("[data-recent-host-id]");
    return items.length;
}

/** Click the recent-connection chip matching `label`. */
export async function clickRecent(label: string): Promise<void> {
    const el = await waitForRecent(label);
    await el.waitForClickable({ timeout: 5_000 });
    await el.click();
}
