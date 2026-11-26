"use client";

import { useEffect } from "react";
import { CUSTOM_CONTROLS } from "./custom";
import type { ControlOf, SettingControlProps } from "./types";

type Props = SettingControlProps<unknown, ControlOf<"custom">>;

/** A control a setting names for itself, from `CUSTOM_CONTROLS`. */
export function CustomControl(props: Props) {
  const { component } = props.definition.control;
  if (!Object.hasOwn(CUSTOM_CONTROLS, component)) {
    return <Unregistered {...props} />;
  }
  const Registered = CUSTOM_CONTROLS[component]!;
  return <Registered {...props} />;
}

/**
 * A custom control nobody registered: the value, read only, and a console
 * error while developing, rather than a row that cannot render.
 */
function Unregistered({ definition, value, id }: Props) {
  const { key } = definition;
  const { component } = definition.control;

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    console.error(
      `Setting "${key}" names the custom control "${component}", which CUSTOM_CONTROLS does not register; it shows read only.`
    );
  }, [key, component]);

  return (
    <output id={id} className="text-small text-ink-soft">
      {typeof value === "string" ? value : JSON.stringify(value)}
    </output>
  );
}
