/**
 * Build step: ensure public/ artifacts are present (prebuilt UI preserved).
 * No Vite rebuild — design is frozen from the last production ship.
 */
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const required = [
  "public/index.html",
  "public/assets/index-BwT13g1_.js",
  "public/assets/index-_oK46CY_.css",
  "public/momentum-snapshot.json",
];

for (const rel of required) {
  await access(path.join(root, rel));
}
console.log("static UI artifacts OK");
