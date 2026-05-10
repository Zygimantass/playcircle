import { expect, test, type Locator, type Page } from "@playwright/test";

test("library row drag loads deck controls", async ({ page }) => {
  await openMixFixture(page);

  const row = page.getByTestId("track-row").nth(3);
  const target = page.getByTestId("deck-B-drop");
  const title = await dragTrackToTarget(page, row, target);

  await expect(target.getByText(title)).toBeVisible();
});

test("library row drag loads beat waveform deck", async ({ page }) => {
  await openMixFixture(page);

  const row = page.getByTestId("track-row").nth(4);
  const target = page.getByTestId("deck-B-beat-drop");
  const title = await dragTrackToTarget(page, row, target);

  await expect(page.getByTestId("deck-B-drop").getByText(title)).toBeVisible();
});

async function openMixFixture(page: Page) {
  await page.goto("/?fixture=rekordbox");
  await expect(page.getByText(/tracks loaded from Rekordbox/)).toBeVisible();
  await page.getByRole("button", { name: "Mix", exact: true }).click();
}

async function dragTrackToTarget(page: Page, row: Locator, target: Locator) {
  await expect(row).toBeVisible();
  const title = await row.locator("[title]").first().getAttribute("title");
  expect(title).toBeTruthy();

  const rowBox = await row.boundingBox();
  const targetBox = await target.boundingBox();
  expect(rowBox).toBeTruthy();
  expect(targetBox).toBeTruthy();

  await page.mouse.move(rowBox!.x + 20, rowBox!.y + rowBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + targetBox!.height / 2, { steps: 20 });
  await page.mouse.up();

  return title!;
}
