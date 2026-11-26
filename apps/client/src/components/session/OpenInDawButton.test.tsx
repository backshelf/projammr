import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "bun:test";
import { OpenInDawButton } from "./OpenInDawButton";

afterEach(cleanup);

describe("OpenInDawButton", () => {
  it("opens the session through a link when a machine holds the set", () => {
    render(<OpenInDawButton sessionId={9} holder={{ name: "studio" }} />);
    const button = screen.getByRole("button", {
      name: "Open in DAW",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(window.location.href).toContain("projammr://session/9");
  });

  it("is disabled when no machine holds the set", () => {
    render(<OpenInDawButton sessionId={9} holder={null} />);
    const button = screen.getByRole("button", {
      name: "Open in DAW",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });
});
