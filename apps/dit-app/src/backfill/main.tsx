import "../app.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MotionProvider } from "@workspace/ui/components/motion-provider";
import { ThemeProvider } from "@workspace/ui/components/theme-provider";

import { BackfillRoot } from "./window";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider bindThemeHotkey={false}>
      <MotionProvider>
        <BackfillRoot />
      </MotionProvider>
    </ThemeProvider>
  </StrictMode>
);
