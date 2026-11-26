import { comboKeys } from "@/components/hotkeys/combo-format";
import { Kbd } from "@workspace/ui/components/kbd";
import { keyedByContent } from "@workspace/ui/lib/keyed";
import { cn } from "@workspace/ui/lib/utils";
import { Fragment } from "react";

/**
 * One combo as key caps: a `Kbd` per key, chord steps set apart. Held keys
 * read "plus" and chord steps "then" to a screen reader. `className` styles
 * the row of caps, `capClassName` each cap (its ink).
 */
export function ComboCaps({
  combo,
  apple,
  className,
  capClassName,
}: {
  combo: string;
  apple: boolean;
  className?: string;
  capClassName?: string;
}) {
  const steps = keyedByContent(comboKeys(combo, apple), (keys) =>
    keys.join("+")
  );
  return (
    <span className={cn("flex items-center gap-2", className)}>
      {steps.map(({ key: stepKey, item: segment }, step) => (
        <span key={stepKey} className="flex items-center gap-1">
          {step > 0 && <span className="sr-only">then</span>}
          {segment.map((key, index) => (
            <Fragment key={key}>
              {index > 0 && <span className="sr-only">plus</span>}
              <Kbd className={cn("min-w-5 text-center", capClassName)}>
                {key}
              </Kbd>
            </Fragment>
          ))}
        </span>
      ))}
    </span>
  );
}
