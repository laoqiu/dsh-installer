import { execFileSync } from "node:child_process";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const output = "lib/client.body.cjs";
execFileSync(
  process.execPath,
  [
    require.resolve("esbuild/bin/esbuild"),
    "src/client.tsx",
    "--bundle",
    "--platform=browser",
    "--format=cjs",
    "--target=es2022",
    "--jsx=automatic",
    "--external:react",
    "--external:react/*",
    "--external:react-dom",
    "--external:react-dom/*",
    "--external:@deepseek-ai/*",
    "--outfile=" + output,
  ],
  { stdio: "inherit" },
);
const body = await readFile(output, "utf8");
await writeFile(
  "lib/client.js",
  'window.__ModuleLoader__.load({id:"dsh-installer",factory:(require)=>{var module={exports:{}};var exports=module.exports;\n' +
    body +
    "\nreturn module.exports;}});\n",
);
await unlink(output);
