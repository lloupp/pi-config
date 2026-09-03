// O auto-check valida o frontmatter de SKILL.md contra o que o pi realmente exige para
// carregar a skill: name e description não vazios (docs/skills.md). Antes ele exigia as
// chaves exatas name/description/compatibility e rejeitava skill válida sem compatibility.
import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadExtension, makeCtx } from "./harness.mjs";

const exec = (cmd, args) =>
  new Promise((resolve) =>
    execFile(cmd, args, (err, stdout, stderr) =>
      resolve({ code: err ? (err.code ?? 1) : 0, stdout: stdout ?? "", stderr: stderr ?? "" })),
  );

const dir = mkdtempSync(join(tmpdir(), "pi-skill-"));

async function checar(frontmatter) {
  const file = join(dir, "SKILL.md");
  writeFileSync(file, `${frontmatter}\n\n# corpo\n`, "utf8");
  const ext = await loadExtension("auto-check.ts", { exec });
  const res = await ext.events.tool_result(
    { toolName: "write", input: { path: file }, content: [{ type: "text", text: "ok" }] },
    makeCtx(),
  );
  return JSON.stringify(res ?? "").includes("[auto-check]");
}

test("skill sem compatibility é aceita: o campo é opcional na spec", async () => {
  assert.equal(await checar("---\nname: x\ndescription: faz algo útil\n---"), false);
});

test("campo desconhecido é aceito: a spec manda ignorá-lo", async () => {
  assert.equal(await checar("---\nname: x\ndescription: faz algo\nauthor: eu\n---"), false);
});

test("skill sem description é rejeitada: o pi não a carregaria", async () => {
  assert.equal(await checar("---\nname: x\n---"), true);
});

test("description vazia é rejeitada", async () => {
  assert.equal(await checar('---\nname: x\ndescription: ""\n---'), true);
});

test("as skills do repo passam na validação", async () => {
  const ext = await loadExtension("auto-check.ts", { exec });
  for (const skill of ["plan", "delegate", "verify", "code-review", "excel-charts", "powerbi"]) {
    const res = await ext.events.tool_result(
      {
        toolName: "write",
        input: { path: `skills/${skill}/SKILL.md` },
        content: [{ type: "text", text: "ok" }],
      },
      makeCtx(),
    );
    assert.ok(!JSON.stringify(res ?? "").includes("[auto-check]"), `skills/${skill} reprovou`);
  }
});
