import { expect, test } from "@playwright/test";

const sortColumns = ["title", "artist", "album", "genre", "bpm", "key", "duration", "energy", "rating", "plays", "added", "fileType"] as const;

test("sorting the full library stays responsive", async ({ page }) => {
  await page.goto("/?fixture=rekordbox");
  await expect(page.getByText(/tracks loaded from Rekordbox/)).toBeVisible();

  const rows = page.getByTestId("track-row");
  await expect(rows.first()).toBeVisible();

  const measurements: Array<{ column: string; ms: number; before: string; after: string; renderedRows: number }> = [];

  for (const column of sortColumns) {
    const before = await rows.first().innerText();
    const ms = await page.evaluate(async (column) => {
      const header = document.querySelector<HTMLButtonElement>(`[data-testid="sort-${column}"]`);
      if (!header) throw new Error(`Missing sort header for ${column}`);

      const startedAt = performance.now();
      header.click();
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);

      return performance.now() - startedAt;
    }, column);

    const after = await rows.first().innerText();
    const renderedRows = await rows.count();
    measurements.push({ column, ms, before, after, renderedRows });
  }

  console.log(JSON.stringify({ sortMeasurements: measurements }, null, 2));

  for (const measurement of measurements) {
    expect(measurement.renderedRows).toBeLessThan(90);
    expect(measurement.ms).toBeLessThan(100);
  }
});
