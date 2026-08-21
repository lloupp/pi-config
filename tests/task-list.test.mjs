// task_list segue o TodoWrite do Claude Code: a lista inteira é reenviada a cada chamada
// e exatamente uma tarefa fica in_progress. O invariante é validado na tool, devolvendo
// erro ao modelo — é o que impede a lista de virar um bloco de notas desatualizado.
import assert from "node:assert/strict";
import { test } from "node:test";
import { contentText, importExtension, loadExtension, makeCtx } from "./harness.mjs";

const { normalizeTasks } = await importExtension("plan-tasks.ts");

const tarefa = (content, status, activeForm) => ({ content, status, activeForm: activeForm ?? `${content}ndo` });

async function chamar(todos, ctx = makeCtx()) {
  const ext = await loadExtension("plan-tasks.ts");
  return ext.tools.task_list.execute("id", { todos }, null, null, ctx);
}

// --- invariante -------------------------------------------------------------

test("aceita exatamente uma tarefa em andamento", () => {
  const { tasks, error } = normalizeTasks([
    tarefa("Mapear extensões", "completed"),
    tarefa("Migrar o checkpoint", "in_progress"),
    tarefa("Escrever testes", "pending"),
  ]);
  assert.equal(error, undefined);
  assert.equal(tasks.length, 3);
});

test("recusa duas tarefas em andamento", () => {
  const { error } = normalizeTasks([tarefa("A", "in_progress"), tarefa("B", "in_progress")]);
  assert.match(error, /apenas uma/i);
});

test("recusa lista com pendências e nenhuma em andamento", () => {
  const { error } = normalizeTasks([tarefa("A", "completed"), tarefa("B", "pending")]);
  assert.match(error, /in_progress/);
});

test("aceita lista toda concluída sem nenhuma em andamento", () => {
  const { tasks, error } = normalizeTasks([tarefa("A", "completed"), tarefa("B", "completed")]);
  assert.equal(error, undefined);
  assert.equal(tasks.length, 2);
});

test("aceita lista vazia", () => {
  assert.deepEqual(normalizeTasks([]), { tasks: [] });
});

test("recusa status desconhecido e content vazio", () => {
  assert.match(normalizeTasks([tarefa("A", "doing")]).error, /status inválido/i);
  assert.match(normalizeTasks([{ content: "  ", status: "pending" }]).error, /content/);
});

test("activeForm ausente cai para o content", () => {
  const { tasks } = normalizeTasks([{ content: "Migrar", status: "in_progress" }]);
  assert.equal(tasks[0].activeForm, "Migrar");
});

// --- tool -------------------------------------------------------------------

test("a lista enviada substitui a anterior", async () => {
  const ext = await loadExtension("plan-tasks.ts");
  const ctx = makeCtx();
  const exec = (todos) => ext.tools.task_list.execute("id", { todos }, null, null, ctx);

  await exec([tarefa("A", "in_progress"), tarefa("B", "pending")]);
  const res = await exec([tarefa("C", "in_progress")]);

  assert.equal(res.details.tasks.length, 1, "a lista nova substitui, não acumula");
  assert.equal(res.details.tasks[0].content, "C");
});

test("erro do invariante volta como isError, sem alterar a lista", async () => {
  const ext = await loadExtension("plan-tasks.ts");
  const ctx = makeCtx();
  const exec = (todos) => ext.tools.task_list.execute("id", { todos }, null, null, ctx);

  await exec([tarefa("A", "in_progress")]);
  const res = await exec([tarefa("B", "in_progress"), tarefa("C", "in_progress")]);

  assert.equal(res.isError, true);
  assert.match(contentText(res), /apenas uma/i);
  assert.equal(res.details.tasks[0].content, "A", "a lista boa anterior precisa sobreviver");
});

test("a saída mostra o gerúndio na tarefa em andamento", async () => {
  const res = await chamar([
    tarefa("Mapear extensões", "completed"),
    { content: "Migrar o checkpoint", activeForm: "Migrando o checkpoint", status: "in_progress" },
    tarefa("Escrever testes", "pending"),
  ]);
  const texto = contentText(res);
  assert.match(texto, /Migrando o checkpoint/);
  assert.match(texto, /☒ Mapear extensões/);
  assert.match(texto, /☐ Escrever testes/);
});

test("a lista aparece no widget enquanto o agente trabalha", async () => {
  const widgets = [];
  const ctx = makeCtx({ ui: { setWidget: (_key, lines) => widgets.push(lines) } });
  await chamar([tarefa("A", "in_progress"), tarefa("B", "pending")], ctx);

  const ultimo = widgets.at(-1);
  assert.ok(ultimo, "o widget precisa ser atualizado na própria chamada da tool");
  assert.match(ultimo.join("\n"), /Tarefas \(0\/2\)/);
});

test("aprovar um plano semeia tarefas com a primeira já em andamento", async () => {
  const { mkdtempSync, writeFileSync, mkdirSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");

  const cwd = mkdtempSync(join(tmpdir(), "pi-plan-"));
  const ext = await loadExtension("plan-tasks.ts");
  const avisos = [];
  const ctx = makeCtx({ cwd, ui: { notify: (msg) => avisos.push(msg) } });

  await ext.commands.plan("objetivo", ctx);
  mkdirSync(join(cwd, ".pi", "plans"), { recursive: true });
  writeFileSync(join(cwd, ".pi", "plans", "objetivo.md"), "1. Primeiro passo\n2. Segundo passo\n", "utf8");

  await ext.commands.implement("", ctx);
  await ext.commands.tasks("", ctx);

  // Sem uma em andamento, a próxima atualização do modelo seria recusada pelo invariante.
  const lista = avisos.at(-1);
  assert.match(lista, /▶ Primeiro passo/);
  assert.match(lista, /☐ Segundo passo/);
});
