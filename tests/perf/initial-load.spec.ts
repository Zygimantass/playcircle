import { expect, test } from "@playwright/test";

type InitialLoadPerf = {
  fixtureFetchStart?: number;
  fixtureFetchEnd?: number;
};

declare global {
  interface Window {
    __playcircleInitialLoadPerf?: InitialLoadPerf;
  }
}

test("initial Rekordbox fixture load time is measured", async ({ page }) => {
  await page.addInitScript(() => {
    window.__playcircleInitialLoadPerf = {};
    const originalFetch = window.fetch.bind(window);

    window.fetch = async (...args) => {
      const url = typeof args[0] === "string" ? args[0] : args[0] instanceof Request ? args[0].url : String(args[0]);
      const isFixture = url.includes("rekordbox-demo-tracks.json");

      if (isFixture) window.__playcircleInitialLoadPerf!.fixtureFetchStart = performance.now();

      const response = await originalFetch(...args);

      if (isFixture) window.__playcircleInitialLoadPerf!.fixtureFetchEnd = performance.now();
      return response;
    };
  });

  const startedAt = Date.now();
  await page.goto("/?fixture=rekordbox", { waitUntil: "commit" });
  const commitMs = Date.now() - startedAt;

  await page.waitForLoadState("domcontentloaded");
  const domContentLoadedMs = Date.now() - startedAt;

  await page.waitForLoadState("load");
  const loadEventMs = Date.now() - startedAt;

  await expect(page.getByText(/tracks loaded from Rekordbox/)).toBeVisible();
  const statusVisibleMs = Date.now() - startedAt;

  const scrollContainer = page.getByTestId("track-table-scroll");
  await expect(scrollContainer).toBeVisible();
  await expect(page.getByTestId("track-row").first()).toBeVisible();
  const firstRowsVisibleMs = Date.now() - startedAt;

  const browserMetrics = await page.evaluate(() => {
    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const fixtureResource = performance
      .getEntriesByType("resource")
      .find((entry) => entry.name.includes("rekordbox-demo-tracks.json")) as PerformanceResourceTiming | undefined;
    const app = window.__playcircleInitialLoadPerf ?? {};

    return {
      navigation: navigation
        ? {
            domContentLoadedEventEnd: navigation.domContentLoadedEventEnd,
            loadEventEnd: navigation.loadEventEnd,
            responseEnd: navigation.responseEnd
          }
        : null,
      fixtureFetchMs: app.fixtureFetchStart !== undefined && app.fixtureFetchEnd !== undefined
        ? app.fixtureFetchEnd - app.fixtureFetchStart
        : null,
      fixtureResource: fixtureResource
        ? {
            duration: fixtureResource.duration,
            transferSize: fixtureResource.transferSize,
            encodedBodySize: fixtureResource.encodedBodySize,
            decodedBodySize: fixtureResource.decodedBodySize,
            responseEnd: fixtureResource.responseEnd,
            startTime: fixtureResource.startTime
          }
        : null,
      renderedRows: document.querySelectorAll("[data-testid='track-row']").length,
      trackCountText: document.body.textContent?.match(/\\d[\\d,]* tracks loaded from Rekordbox/)?.[0] ?? null
    };
  });

  const measurements = {
    commitMs,
    domContentLoadedMs,
    loadEventMs,
    statusVisibleMs,
    firstRowsVisibleMs,
    appDataAndRenderMs:
      browserMetrics.fixtureResource && browserMetrics.fixtureFetchMs !== null
        ? statusVisibleMs - browserMetrics.fixtureResource.startTime - browserMetrics.fixtureFetchMs
        : null,
    ...browserMetrics
  };

  console.log(JSON.stringify({ initialLoad: measurements }, null, 2));

  expect(browserMetrics.renderedRows).toBeGreaterThan(10);
  expect(statusVisibleMs).toBeLessThan(8_000);
  expect(firstRowsVisibleMs).toBeLessThan(8_000);
});
