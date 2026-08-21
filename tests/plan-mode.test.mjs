// plan-tasks.ts: o modo plano segue o mesmo desenho do plan mode do Claude Code —
// escrita bloqueada fora do arquivo de plano, bash liberado para investigar. A allowlist
// de bash anterior deixava passar `npm run` e `pip install` enquanto barrava um `| head`.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { loadExtension, makeCtx } from "./harness.mjs";

const ext = await loadExtension("plan-tasks.ts");
const onToolCall = ext.events.tool_call;

const projeto = makeCtx({ cwd: mkdtempSync(join(tmpdir(), "pi-plan-")) });
await ext.commands.plan("melhorar extensoes", projeto);

const bash = (command) => onToolCall({ toolName: "bash", input: { command } }, projeto);

test("bash com pipe é permitido", async () => {
  assert.equal(await bash("git log --oneline | head -5"), undefined);
});

test("bash com encadeamento é permitido", async () => {
  assert.equal(await bash("ls -la && grep -r TODO ."), undefined);
});

test("escrita fora de .pi/plans é bloqueada", async () => {
  const res = await onToolCall({ toolName: "write", input: { path: "src/index.ts" } }, projeto);
  assert.equal(res?.block, true);
  assert.match(res.reason, /\.pi\/plans/);
});

test("edição fora de .pi/plans é bloqueada", async () => {
  const res = await onToolCall({ toolName: "edit", input: { path: "package.json" } }, projeto);
  assert.equal(res?.block, true);
});

test("escrita no arquivo de plano é permitida", async () => {
  const alvo = resolve(projeto.cwd, ".pi/plans/melhorar-extensoes.md");
  assert.equal(await onToolCall({ toolName: "write", input: { path: alvo } }, projeto), undefined);
});

test("escrita em qualquer arquivo dentro de .pi/plans é permitida", async () => {
  const alvo = resolve(projeto.cwd, ".pi/plans/outro-nome.md");
  assert.equal(await onToolCall({ toolName: "write", input: { path: alvo } }, projeto), undefined);
});

test("traversal para fora de .pi/plans é bloqueado", async () => {
  const alvo = resolve(projeto.cwd, ".pi/plans/../../src/burlado.ts");
  const res = await onToolCall({ toolName: "write", input: { path: alvo } }, projeto);
  assert.equal(res?.block, true);
});

test("subagent em mode=full é bloqueado", async () => {
  const res = await onToolCall({ toolName: "subagent", input: { mode: "full" } }, projeto);
  assert.equal(res?.block, true);
});

test("subagent em mode=explore é permitido", async () => {
  assert.equal(await onToolCall({ toolName: "subagent", input: { mode: "explore" } }, projeto), undefined);
});

test("a instrução injetada proíbe alterar o sistema", async () => {
  const injected = await ext.events.before_agent_start({}, projeto);
  const texto = injected.message.content;
  assert.match(texto, /NÃO DEVE/);
  assert.match(texto, /exit_plan/);
  assert.match(texto, /\.pi\/plans|plano/);
});

test("fora do modo plano nada é bloqueado", async () => {
  const outro = makeCtx({ cwd: mkdtempSync(join(tmpdir(), "pi-plan-off-")) });
  const off = await loadExtension("plan-tasks.ts");
  assert.equal(await off.events.tool_call({ toolName: "write", input: { path: "qualquer.ts" } }, outro), undefined);
});
