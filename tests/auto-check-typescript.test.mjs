import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { contentText, loadExtension, makeCtx } from "./harness.mjs";

const realExec = (calls = []) => async (command, args, options = {}) => {
  calls.push([command, ...args]);
  return await new Promise((resolve) => {
    execFile(command, args, { timeout: options.timeout }, (error, stdout, stderr) => {
      resolve({
        code: error ? (typeof error.code === "number" ? error.code : 1) : 0,
        stdout: stdout ?? "",
        stderr: stderr ?? "",
        killed: Boolean(error?.killed),
      });
    });
  });
};

test("arquivo .ts inválido é rejeitado pelo parser TypeScript real", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-autocheck-ts-"));
  writeFileSync(join(cwd, "ext.ts"), "const x: number = ;\n");
  const calls = [];
  const ext = await loadExtension("auto-check.ts", { exec: realExec(calls) });

  const response = await ext.events.tool_result(
    { toolName: "write", input: { path: "ext.ts" }, content: [{ type: "text", text: "gravado" }] },
    makeCtx({ cwd }),
  );

  assert.match(contentText(response), /auto-check.*sintaxe/is);
  assert.equal(calls[0][0], "node");
  assert.ok(calls[0].includes("-e"));
  assert.match(calls[0].join(" "), /stripTypeScriptTypes/);
});

test("enum e parameter property válidos são aceitos sem executar o módulo", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-autocheck-ts-transform-"));
  writeFileSync(
    join(cwd, "ext.ts"),
    [
      "enum Mode { A, B }",
      "class Config { constructor(public mode: Mode) {} }",
      "const config = new Config(Mode.A);",
      'throw new Error("este módulo não pode ser executado pelo auto-check");',
      "void config;",
      "",
    ].join("\n"),
  );

  const ext = await loadExtension("auto-check.ts", { exec: realExec() });
  const response = await ext.events.tool_result(
    { toolName: "edit", input: { path: "ext.ts" }, content: [{ type: "text", text: "ok" }] },
    makeCtx({ cwd }),
  );

  assert.equal(response, undefined);
});
