import { expect, test } from "@playwright/test";

test("library node switching stays responsive", async ({ page }) => {
  await page.goto("/?fixture=rekordbox");
  await expect(page.getByText(/tracks loaded from Rekordbox/)).toBeVisible();

  const measurements: Array<{ label: string; ms: number; firstRow: string }> = [];

  for (const label of ["Recently Added", "All Tracks", "Recently Added", "All Tracks"]) {
    const ms = await page.evaluate(async (label) => {
      const button = Array.from(document.querySelectorAll("button")).find((item) => item.textContent?.includes(label));
      if (!button) throw new Error(`missing library node ${label}`);

      const startedAt = performance.now();
      (button as HTMLButtonElement).click();
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      return performance.now() - startedAt;
    }, label);

    const firstRow = await page.getByTestId("track-row").first().innerText();
    measurements.push({ label, ms, firstRow });
  }

  console.log(JSON.stringify({ nodeSwitchMeasurements: measurements }, null, 2));

  for (const measurement of measurements) {
    expect(measurement.ms).toBeLessThan(100);
  }
});
