import {
  FormatProvider,
  Formatted,
  useFormat,
} from "@workspace/ui/components/format-provider";
import {
  DEFAULT_FORMAT_PREFS,
  type FormatPrefs,
  runtimeZone,
} from "@workspace/ui/lib/formatters";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";

afterEach(cleanup);

/** A zone other than the one this suite runs in, so a correction shows. */
const ELSEWHERE = runtimeZone() === "Asia/Tokyo" ? "UTC" : "Asia/Tokyo";

function Zone() {
  return <p data-testid="zone">{useFormat().timeZone}</p>;
}

const provided = (prefs: FormatPrefs = DEFAULT_FORMAT_PREFS) => (
  <FormatProvider prefs={prefs} zone={ELSEWHERE}>
    <Zone />
  </FormatProvider>
);

describe("useFormat", () => {
  it("formats at the defaults in this runtime's zone with no provider", () => {
    render(
      <Formatted>
        {(format) => (
          <p>
            {format.timeZone} {format.dateTime("2026-08-03T14:05:00Z")}
          </p>
        )}
      </Formatted>
    );

    const expected = new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date("2026-08-03T14:05:00Z"));
    expect(screen.getByText(`${runtimeZone()} ${expected}`)).toBeDefined();
  });
});

describe("FormatProvider", () => {
  it("formats the server's HTML in the zone it was handed", () => {
    const container = document.createElement("div");
    container.innerHTML = renderToString(provided());

    expect(container.textContent).toBe(ELSEWHERE);
  });

  it("hydrates in the server's zone, then follows the browser's", async () => {
    const container = document.createElement("div");
    container.innerHTML = renderToString(provided());
    document.body.append(container);
    const onRecoverableError = mock();

    const root = await act(async () =>
      hydrateRoot(container, provided(), { onRecoverableError })
    );

    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(container.textContent).toBe(runtimeZone());
    await act(async () => root.unmount());
    container.remove();
  });

  it("reads in the preferred zone over both", () => {
    render(provided({ ...DEFAULT_FORMAT_PREFS, timeZone: "America/Denver" }));

    expect(screen.getByTestId("zone").textContent).toBe("America/Denver");
  });

  it("hands its set to a render function through Formatted", () => {
    render(
      <FormatProvider
        prefs={{ ...DEFAULT_FORMAT_PREFS, keyNotation: "camelot" }}
        zone="UTC"
      >
        <Formatted>{(format) => <p>{format.key("A", "minor")}</p>}</Formatted>
      </FormatProvider>
    );

    expect(screen.getByText("8A")).toBeDefined();
  });
});
