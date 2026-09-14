import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { contentText, loadExtension, makeCtx } from "./harness.mjs";

const result = (code, stderr = "") => ({ code, stdout: "", stderr, killed: false });

test("arquivo .ts passa pelo parser TypeScript sem execução", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-autocheck-ts-"));
  const file = join(cwd, "ext.ts");
  writeFileSync(file, "const x: number = ;\n");
  const calls = [];
  const exec = async (command, args) => {
    calls.push([command, ...args]);
    return result(1, "ERR_INVALID_TYPESCRIPT_SYNTAX");
  };

  const ext = await loadExtension("auto-check.ts", { exec });
  const response = await ext.events.tool_result(
    { toolName: "write", input: { path: "ext.ts" }, content: [{ type: "text", text: "gravado" }] },
    makeCtx({ cwd }),
  );

  assert.match(contentText(response), /auto-check.*TypeScript|auto-check.*sintaxe/is);
  assert.equal(calls[0][0], "node");
  assert.ok(calls[0].includes("-e"));
  assert.match(calls[0].join(" "), /stripTypeScriptTypes/);
});

test("TypeScript válido não altera o resultado da edição", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-autocheck-ts-ok-"));
  writeFileSync(join(cwd, "ext.ts"), "const x: number = 1;\n");
  const exec = async () => result(0);

  const ext = await loadExtension("auto-check.ts", { exec });
  const response = await ext.events.tool_result(
    { toolName: "edit", input: { path: "ext.ts" }, content: [{ type: "text", text: "ok" }] },
    makeCtx({ cwd }),
  );

  assert.equal(response, undefined);
});
