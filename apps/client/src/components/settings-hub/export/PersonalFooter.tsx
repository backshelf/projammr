import { GroupHead } from "../GroupHead";
import { ExportButton } from "./ExportButton";
import { ImportFlow } from "./ImportFlow";

const LABEL = "Export and import";

/** The foot of the Personal section: the user's own settings as a file, out to keep and back in. */
export function PersonalFooter() {
  return (
    <section aria-label={LABEL}>
      <GroupHead
        label={LABEL}
        description="Your own settings as a file: keep a copy, or take them to another instance. Importing one shows what would change before anything does."
      />
      <div className="flex flex-wrap gap-2">
        <ExportButton />
        <ImportFlow />
      </div>
    </section>
  );
}
