import type { SettingDefinition } from "@workspace/settings";
import { cn } from "@workspace/ui/lib/utils";
import { summariseSettingValue } from "./format";

/** A setting's value on one line of a list, the whole of it in the title where the line cut it short. */
function SettingValueText({
  definition,
  value,
  className,
}: {
  definition: SettingDefinition | undefined;
  value: unknown;
  className?: string;
}) {
  const { text, whole } = summariseSettingValue(definition, value);
  return (
    <span title={whole} className={cn("break-words", className)}>
      {text}
    </span>
  );
}

/** A value's move, `from → to`: where it was in soft ink, where it went in ink. */
export function ValueChange({
  definition,
  from,
  to,
}: {
  definition: SettingDefinition | undefined;
  from: unknown;
  to: unknown;
}) {
  return (
    <span className="text-ink-soft">
      <SettingValueText definition={definition} value={from} />
      <span aria-hidden> →</span>
      <span className="sr-only"> to</span>{" "}
      <SettingValueText
        definition={definition}
        value={to}
        className="text-ink"
      />
    </span>
  );
}
