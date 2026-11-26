import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import { useEffect, useState } from "react";

afterEach(cleanup);

function Counter({ onMount }: { onMount: () => void }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    onMount();
  }, [onMount]);

  return (
    <button onClick={() => setCount((current) => current + 1)}>
      clicked {count} times
    </button>
  );
}

describe("the client DOM preload", () => {
  it("runs an effect and a click handler", () => {
    const onMount = mock();
    render(<Counter onMount={onMount} />);

    expect(onMount).toHaveBeenCalledTimes(1);
    const button = screen.getByRole("button", { name: "clicked 0 times" });

    fireEvent.click(button);

    expect(
      screen.getByRole("button", { name: "clicked 1 times" })
    ).toBeTruthy();
  });
});
