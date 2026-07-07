import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env"),
});

process.env.TZ = "Asia/Kolkata";

import app from "./app";

const PORT = Number(process.env.SERVER_PORT ?? process.env.PORT ?? 3000);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`╔═══════════════════════════════════════════════╗`);
  console.log(`║  Radiology Service on port ${PORT}               ║`);
  console.log(`║  Orthanc: ${process.env.ORTHANC_URL ?? "(not set)"}      `);
  console.log(`║  Ollama:  ${process.env.OLLAMA_URL ?? "(not set)"}      `);
  console.log(`║  Mode:    ${process.env.NODE_ENV ?? "development"}                     ║`);
  console.log(`╚═══════════════════════════════════════════════╝`);
});
