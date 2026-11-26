import { IconSvg } from "@tabler/icons-react";
import { createElement } from "react";
import { LOGO, logoShapeKey } from "@workspace/ui/lib/logo-paths";

export function Logo() {
  return (
    <IconSvg
      strokeLinejoin={"round"}
      viewBox={LOGO.viewBox}
      version={"1.1"}
      fillRule={"evenodd"}
      clipRule={"evenodd"}
      size={"2em"}
      strokeMiterlimit={2}
      suppressHydrationWarning
      className={"rounded-md"}
    >
      <g id="Artboard11" className={"fill-primary"}>
        {LOGO.shapes.map((shape) =>
          createElement(shape.tag, { key: logoShapeKey(shape), ...shape.attrs })
        )}
      </g>
    </IconSvg>
  );
}
