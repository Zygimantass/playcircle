import { expect, test, type Locator, type Page } from "@playwright/test";

test("creates a playlist and adds a dragged track", async ({ page }) => {
  await page.goto("/?fixture=rekordbox");
  await expect(page.getByText(/tracks loaded from Rekordbox/)).toBeVisible();

  await page.getByTestId("new-playlist-button").click();
  await page.getByRole("textbox", { name: "Playlist name" }).fill("Playwright Playlist");
  await page.getByRole("textbox", { name: "Playlist name" }).press("Enter");

  const playlist = page.getByTestId("playlist-row").filter({ hasText: "Playwright Playlist" });
  await expect(playlist).toBeVisible();
  await expect(page.getByText("Created Playwright Playlist")).toBeVisible();
  await expect(page.getByTestId("track-row")).toHaveCount(0);

  await page.getByRole("button", { name: /All Tracks/ }).click();
  const row = page.getByTestId("track-row").first();
  const title = await dragTrackToTarget(page, row, playlist);

  await expect(playlist).toContainText("1");
  expect(await page.getByTestId("track-row").count()).toBeGreaterThan(10);
  await playlist.click();
  await expect(page.getByTestId("track-row").filter({ hasText: title })).toBeVisible();

  const regularPlaylist = page
    .locator("[data-testid='playlist-row'][data-playlist-folder='false']")
    .filter({ hasText: "small loopy" })
    .first();
  await dragLocatorToTarget(page, playlist, regularPlaylist);
  await expect(page.getByText("Moved Playwright Playlist to small loopy")).toBeHidden();

  const folder = page
    .locator("[data-testid='playlist-row'][data-playlist-folder='true']")
    .filter({ hasText: "hq" })
    .first();
  await dragLocatorToTarget(page, playlist, folder);

  await expect(page.getByText("Moved Playwright Playlist to hq")).toBeVisible();
});

async function dragTrackToTarget(page: Page, row: Locator, target: Locator) {
  await expect(row).toBeVisible();
  const title = await row.locator("[title]").first().getAttribute("title");
  expect(title).toBeTruthy();

  await dragLocatorToTarget(page, row, target);

  return title!;
}

async function dragLocatorToTarget(page: Page, source: Locator, target: Locator) {
  await expect(source).toBeVisible();
  await expect(target).toBeVisible();

  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  expect(sourceBox).toBeTruthy();
  expect(targetBox).toBeTruthy();

  await page.mouse.move(sourceBox!.x + 20, sourceBox!.y + sourceBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + targetBox!.height / 2, { steps: 20 });
  await page.mouse.up();
}
