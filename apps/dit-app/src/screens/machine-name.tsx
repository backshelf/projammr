import { useId, useState, type JSX, type SubmitEvent } from "react";
import { Button } from "@workspace/ui/components/button";
import { Field, FieldLabel } from "@workspace/ui/components/field";

import { call } from "../bridge";
import { ErrorLine } from "../error-line";
import { useFocusTarget } from "../focus-target";
import { PanelHead } from "../panel-head";
import { PanelInput } from "../panel-input";
import { useCommand } from "../use-command";

/**
 * The hub refused the name this computer beats as, because another of the account's machines holds it. Nothing is
 * pushed until it has another name, so this takes the panel until the hub accepts one.
 */
export function MachineName({
  refused,
  current,
}: {
  /** The name the hub refused. */
  refused: string;
  /** The configured name, the one to edit. */
  current: string;
}): JSX.Element {
  const id = useId();
  const [name, setName] = useState(current);
  const focusTarget = useFocusTarget();
  const { run, pending, error } = useCommand();
  const trimmed = name.trim();

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    void run(() => call("set_setting", { key: "machineName", value: trimmed }));
  }

  return (
    <div className="flex flex-col gap-4">
      <PanelHead
        title="Name this computer"
        lede={`Another of your machines is called ${refused}. Pick another name.`}
        blocking
      />
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field>
          <FieldLabel htmlFor={id}>Machine name</FieldLabel>
          <PanelInput
            id={id}
            value={name}
            onChange={(event) => setName(event.target.value)}
            ref={focusTarget}
            spellCheck={false}
            aria-invalid={error !== null || undefined}
          />
        </Field>
        <ErrorLine error={error} />
        <Button
          type="submit"
          size="lg"
          disabled={pending || trimmed === "" || trimmed === refused}
          className="self-start"
        >
          Use this name
        </Button>
      </form>
    </div>
  );
}
