import { expect, test } from "@playwright/test";

test("all tracks library loads and scrolls with bounded row rendering", async ({ page }) => {
  const consoleMessages: string[] = [];
  page.on("console", (message) => consoleMessages.push(`${message.type()}: ${message.text()}`));

  const startedAt = Date.now();
  await page.goto("/?fixture=rekordbox");
  await expect(page.getByText(/tracks loaded from Rekordbox/)).toBeVisible();
  const loadMs = Date.now() - startedAt;

  const scrollContainer = page.getByTestId("track-table-scroll");
  await expect(scrollContainer).toBeVisible();

  const rowCount = await page.getByTestId("track-row").count();
  expect(rowCount).toBeGreaterThan(10);
  expect(rowCount).toBeLessThan(90);

  const scrollInfo = await scrollContainer.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    scrollTop: element.scrollTop
  }));

  expect(scrollInfo.scrollHeight).toBeGreaterThan(scrollInfo.clientHeight);

  const scrollMs = await page.evaluate(async () => {
    const element = document.querySelector<HTMLElement>("[data-testid='track-table-scroll']");
    if (!element) throw new Error("missing track table scroll container");

    const started = performance.now();
    for (let index = 0; index < 30; index += 1) {
      element.scrollTop = (element.scrollHeight - element.clientHeight) * (index / 29);
      element.dispatchEvent(new Event("scroll", { bubbles: true }));
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    return performance.now() - started;
  });

  const finalScrollTop = await scrollContainer.evaluate((element) => element.scrollTop);
  expect(finalScrollTop).toBeGreaterThan(0);

  console.log(JSON.stringify({
    loadMs,
    renderedRows: rowCount,
    scrollHeight: scrollInfo.scrollHeight,
    clientHeight: scrollInfo.clientHeight,
    scrollMs,
    consoleMessages
  }, null, 2));
});
