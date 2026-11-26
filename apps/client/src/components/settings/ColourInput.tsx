import { Input } from "@workspace/ui/components/input";
import type { ComponentProps } from "react";
import { z } from "zod";

/** A colour as the API takes one: `#rrggbb`, or `#rrggbbaa` with alpha. */
export const colourHexField = z
  .string()
  .regex(
    /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/,
    "Use a hex colour with 6 or 8 digits"
  );

/** What a `ColourInput` may hold: a 6- or 8-digit hex colour, or nothing. */
export const optionalHexColourSchema = colourHexField.or(z.literal(""));

type ColourInputProps = {
  id: string;
  value: string | undefined;
  onChange: (value: string) => void;
} & Pick<ComponentProps<"input">, "name" | "onBlur" | "ref">;

/** A hex text field paired with the native colour picker, sharing one value. */
export function ColourInput({
  id,
  value,
  onChange,
  ...field
}: ColourInputProps) {
  return (
    <div className={"flex gap-1.5"}>
      <Input
        {...field}
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        // eslint-disable-next-line no-restricted-syntax -- the field takes a hex colour, so its placeholder is the format itself
        placeholder="#000000"
        aria-label="Hex colour"
        className="w-24"
      />
      <Input
        type="color"
        aria-label="Colour picker"
        onChange={(e) => onChange(e.target.value)}
        // eslint-disable-next-line no-restricted-syntax -- a colour input only accepts a hex value, and an empty one shows as black anyway
        value={value || "#101010"}
        className="w-9 shrink-0 p-0.5"
      />
    </div>
  );
}
