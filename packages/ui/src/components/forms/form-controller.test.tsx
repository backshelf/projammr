import { FormController } from "@workspace/ui/components/forms/form-controller";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "bun:test";
import { useForm } from "react-hook-form";

afterEach(cleanup);

type NameValues = { displayName: string };

function TextForm() {
  const form = useForm<NameValues>({ defaultValues: { displayName: "" } });
  return (
    <FormController
      name="displayName"
      control={form.control}
      label="Your name"
      type="input"
    />
  );
}

describe("FormController input", () => {
  it("takes its accessible name from the visible label, not the field key", () => {
    render(<TextForm />);

    // A regression guard for a field announced by its camelCase RHF key
    // ("displayName") instead of the label text beside it.
    expect(screen.getByRole("textbox", { name: "Your name" })).toBeInstanceOf(
      HTMLInputElement
    );
  });

  it("renders title inputs with design-system font and placeholder tokens", () => {
    function TitleForm() {
      const form = useForm<NameValues>({ defaultValues: { displayName: "" } });
      return (
        <FormController
          name="displayName"
          control={form.control}
          label="Track title"
          type="title"
          placeholder="Untitled"
        />
      );
    }
    render(<TitleForm />);

    const input = screen.getByRole("textbox", { name: "Track title" });
    expect(input.className).toContain("font-heading");
    expect(input.className).toContain("placeholder:text-ink-faint");
    expect(input.className).not.toContain("text-3xl");
    expect(input.className).not.toContain("placeholder:font-sans");
  });
});
