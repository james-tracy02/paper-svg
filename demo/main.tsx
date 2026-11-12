import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { makeSprite, registerCustomSprite } from "paper-svg";
import App from "./App";
import { STAR_SPRITE_ID, STAR_SVG } from "./puppet";

// Register before the first build: setCustomSprite resolves the id when it is called.
registerCustomSprite(makeSprite(STAR_SPRITE_ID, STAR_SVG));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
