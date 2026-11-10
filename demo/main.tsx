import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { makeSprite, registerCustomSprite } from "paper-svg";
import App from "./App";
import { STAR_SPRITE_ID } from "./puppet";

const STAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <path fill="#ffd54a" d="M50 5 L61 38 L95 38 L68 59 L79 93 L50 72 L21 93 L32 59 L5 38 L39 38 Z" />
  <path fill="#f59e0b" d="M50 30 L56 45 L72 45 L59 55 L64 71 L50 61 L36 71 L41 55 L28 45 L44 45 Z" />
</svg>`;

// Register before the first build: setCustomSprite resolves the id when it is called.
registerCustomSprite(makeSprite(STAR_SPRITE_ID, STAR_SVG));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
