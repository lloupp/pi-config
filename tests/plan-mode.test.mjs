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

test("/plan pede o modo plano ao sistema de permissões", async () => {
  // O modo plano virou um dos modos do ciclo (Shift+Tab); quem manda no estado é o
  // permissions.ts, e a conversa acontece pelo pi.events.
  const outro = await loadExtension("plan-tasks.ts");
  const pedidos = [];
  outro.bus.on("permissions:set-mode", (data) => pedidos.push(data.mode));

  await outro.commands.plan("objetivo", makeCtx({ cwd: mkdtempSync(join(tmpdir(), "pi-plan-")) }));
  assert.deepEqual(pedidos, ["plano"]);
});

test("entrar em modo plano com UI real não quebra ao pintar o widget", async () => {
  // Regressão: updatePlanUi desestruturava ctx.ui.theme, e fg usa `this` — pressionar
  // Shift+Tab para o modo plano estourava com "Cannot read properties of undefined
  // (reading 'fgColors')" a cada evento permissions:mode.
  const cwd = mkdtempSync(join(tmpdir(), "pi-plan-"));
  const status = [];
  const widgets = [];
  const ctx = makeCtx({
    cwd,
    ui: { setStatus: (_k, v) => status.push(v), setWidget: (_k, v) => widgets.push(v) },
  });
  const ext3 = await loadExtension("plan-tasks.ts");
  await ext3.events.session_start({}, ctx);

  ext3.bus.emit("permissions:mode", { mode: "plano" });

  assert.ok(status.some((s) => typeof s === "string" && s.includes("plan")), "o rodapé precisa marcar o modo plano");
  assert.ok(widgets.at(-1)?.join("\n").includes("Modo plano ativo"));
});

test("a lista de tarefas também é pintada sem desligar do theme", async () => {
  const ctx = makeCtx({ ui: { setWidget: () => {}, setStatus: () => {} } });
  const ext4 = await loadExtension("plan-tasks.ts");
  await ext4.tools.task_list.execute(
    "id",
    { todos: [{ content: "A", activeForm: "Fazendo A", status: "in_progress" }] },
    null,
    null,
    ctx,
  );
});

test("sair do modo plano pelo ciclo desativa o bloqueio de escrita", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-plan-"));
  const ctx = makeCtx({ cwd });
  const ext2 = await loadExtension("plan-tasks.ts");
  await ext2.events.session_start({}, ctx); // registra o ctx para os handlers do barramento

  ext2.bus.emit("permissions:mode", { mode: "plano" });
  const bloqueado = await ext2.events.tool_call({ toolName: "write", input: { path: "src/a.ts" } }, ctx);
  assert.equal(bloqueado?.block, true, "entrar em modo plano pelo ciclo deve bloquear escrita");

  ext2.bus.emit("permissions:mode", { mode: "perguntar" });
  const liberado = await ext2.events.tool_call({ toolName: "write", input: { path: "src/a.ts" } }, ctx);
  assert.equal(liberado, undefined, "sair do modo plano deve liberar");
});

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
