import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const root = dirname(require.resolve("pdfjs-dist/package.json"));
const { version } = require("pdfjs-dist/package.json");
const destination = new URL("../public/pdfjs/", import.meta.url);
await mkdir(destination, { recursive: true });
await copyFile(join(root, "build/pdf.worker.min.mjs"), new URL(`pdf.worker-${version}.min.mjs`, destination));
