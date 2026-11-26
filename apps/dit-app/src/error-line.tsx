import type { JSX } from "react";

/** Why something was refused, in the danger ink and announced; nothing rendered while there is no reason. */
export function ErrorLine({
  error,
  id,
}: {
  error: string | null;
  id?: string;
}): JSX.Element | null {
  if (error === null) return null;
  return (
    <p id={id} role="alert" className="text-small text-pretty text-danger">
      {error}
    </p>
  );
}
