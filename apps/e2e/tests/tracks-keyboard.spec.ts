import { expect, expectNoSeriousViolations, seedTrack, test } from "./fixtures";

test("move through the tracks table and edit a cell with the keyboard alone", async ({
  page,
  request,
}) => {
  const { projectId } = await seedTrack(request, {
    project: "Keyboard project",
    track: "Alpha",
  });
  for (const title of ["Bravo", "Charlie"]) {
    const track = await request.post("/api/tracks", {
      data: { title, projectId },
    });
    expect(track.status()).toBe(201);
  }
  await page.goto(`/project/${projectId}/track/all`);

  const grid = page.getByRole("grid");
  await expect(grid).toBeVisible();
  const row = (title: string) =>
    grid.getByRole("row").filter({ hasText: title });
  // An empty artists cell reads "—", as does a later column's; the artists one
  // comes first in the row.
  const artistsCell = (title: string) =>
    row(title).getByRole("gridcell", { name: "—", exact: true }).first();
  const selected = grid.getByRole("gridcell", { selected: true });
  // A cell is where the keyboard is when it has focus and is the one selected.
  const expectAt = async (cell: ReturnType<typeof row>) => {
    await expect(cell).toBeFocused();
    await expect(selected).toHaveCount(1);
    await expect(cell).toHaveAttribute("aria-selected", "true");
  };

  // The grid is one tab stop among the page's other controls: Tab until focus
  // lands on a cell, which is the first row's title, with no pointer involved.
  let landed = false;
  for (let stop = 0; stop < 100 && !landed; stop++) {
    await page.keyboard.press("Tab");
    landed = await page.evaluate(
      () => document.activeElement?.getAttribute("role") === "gridcell"
    );
  }
  const alphaTitle = row("Alpha").getByRole("gridcell", {
    name: "Alpha",
    exact: true,
  });
  await expectAt(alphaTitle);

  // Arrow keys move the selected cell one step and the focus goes with it.
  await page.keyboard.press("ArrowDown");
  const bravoTitle = row("Bravo").getByRole("gridcell", {
    name: "Bravo",
    exact: true,
  });
  await expectAt(bravoTitle);

  await page.keyboard.press("ArrowRight");
  const bravoArtists = artistsCell("Bravo");
  await expectAt(bravoArtists);

  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  const bravoStatus = row("Bravo").getByRole("gridcell", {
    name: "TO DO",
    exact: true,
  });
  await expectAt(bravoStatus);

  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowUp");
  const alphaPriority = row("Alpha").getByRole("gridcell", {
    name: "None",
    exact: true,
  });
  await expectAt(alphaPriority);

  // Enter on an editable cell opens its editor with focus inside; Escape puts
  // the old value and the focus back on the cell.
  await page.keyboard.press("ArrowLeft");
  const alphaArtists = artistsCell("Alpha");
  await expectAt(alphaArtists);
  await page.keyboard.press("Enter");
  // The cell's name changes while the editor is in it, so the editor is found
  // through the grid: the only text box a grid holds is one being edited.
  const editor = grid.getByRole("textbox");
  await expect(editor).toBeFocused();
  await page.keyboard.type("Nobody");
  await expect(editor).toHaveValue("Nobody");
  await page.keyboard.press("Escape");
  await expect(editor).toBeHidden();
  await expectAt(alphaArtists);

  // A picker cell opens its options on Enter, and Escape closes them with the
  // cell still selected and focused.
  await page.keyboard.press("ArrowRight");
  await expectAt(alphaPriority);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toBeHidden();
  await expectAt(alphaPriority);

  await expectNoSeriousViolations(page);
});
