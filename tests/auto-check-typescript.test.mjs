import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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

test("Node sem stripTypeScriptTypes pula a verificação em vez de acusar erro", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-autocheck-ts-old-node-"));
  writeFileSync(join(cwd, "ext.ts"), "const x: number = 1;\n");
  // Simula Node antigo: o preload remove a API antes do script do auto-check rodar.
  const preload = join(cwd, "sem-strip.cjs");
  writeFileSync(preload, 'require("node:module").stripTypeScriptTypes = undefined;\n');
  const exec = realExec();
  const ext = await loadExtension("auto-check.ts", {
    exec: (command, args, options) => exec(command, command === "node" ? ["--require", preload, ...args] : args, options),
  });

  const response = await ext.events.tool_result(
    { toolName: "write", input: { path: "ext.ts" }, content: [{ type: "text", text: "gravado" }] },
    makeCtx({ cwd }),
  );

  assert.equal(response, undefined);
});

test("JSON com comentários (tsconfig, .vscode) não é acusado; .json comum continua estrito", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-autocheck-jsonc-"));
  const jsonc = '{\n  // comentário permitido\n  "compilerOptions": {},\n}\n';
  writeFileSync(join(cwd, "tsconfig.json"), jsonc);
  writeFileSync(join(cwd, "tsconfig.build.json"), jsonc);
  mkdirSync(join(cwd, ".vscode"));
  writeFileSync(join(cwd, ".vscode", "settings.json"), jsonc);
  writeFileSync(join(cwd, "data.json"), jsonc);
  const ext = await loadExtension("auto-check.ts", { exec: realExec() });
  const check = (path) =>
    ext.events.tool_result(
      { toolName: "write", input: { path }, content: [{ type: "text", text: "gravado" }] },
      makeCtx({ cwd }),
    );

  assert.equal(await check("tsconfig.json"), undefined);
  assert.equal(await check("tsconfig.build.json"), undefined);
  assert.equal(await check(".vscode/settings.json"), undefined);
  assert.match(contentText(await check("data.json")), /auto-check.*sintaxe/is);
});
