// /rewind volta ao estado de um turno inteiro, como no Claude Code: código, conversa ou
// ambos. O /undo continua existindo para desfazer uma única edição.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { importExtension, loadExtension, makeCtx } from "./harness.mjs";

const { groupTurns, planRestore } = await importExtension("checkpoint.ts");

// --- agrupamento -------------------------------------------------------------

const snap = (path, turnId, turnLabel) => ({ path, absPath: `/p/${path}`, turnId, turnLabel });

test("snapshots do mesmo turno viram um grupo só", () => {
  const turns = groupTurns([
    snap("a.ts", "e1", "corrige o parser"),
    snap("b.ts", "e1", "corrige o parser"),
    snap("c.ts", "e2", "adiciona testes"),
  ]);
  assert.equal(turns.length, 2);
  assert.deepEqual(turns[0].files, ["a.ts", "b.ts"]);
  assert.equal(turns[0].start, 0);
  assert.equal(turns[1].start, 2);
});

test("o mesmo arquivo editado duas vezes no turno aparece uma vez", () => {
  const turns = groupTurns([snap("a.ts", "e1", "x"), snap("a.ts", "e1", "x")]);
  assert.deepEqual(turns[0].files, ["a.ts"]);
});

test("sem id de sessão, rótulos diferentes ainda separam turnos", () => {
  // Numa sessão sem histórico o turnId vem undefined; sem esta regra todos os turnos
  // se fundiriam num só e o /rewind viraria "desfazer tudo".
  const turns = groupTurns([snap("a.ts", undefined, "10:00:01"), snap("b.ts", undefined, "10:05:22")]);
  assert.equal(turns.length, 2);
});

test("planRestore devolve o estado mais antigo de cada arquivo", () => {
  const list = [
    { absPath: "/p/a", content: "a-v1" },
    { absPath: "/p/b", content: "b-v1" },
    { absPath: "/p/a", content: "a-v2" },
  ];
  const alvo = planRestore(list, 0);
  assert.equal(alvo.length, 2, "um por arquivo");
  assert.equal(alvo.find((s) => s.absPath === "/p/a").content, "a-v1", "o intermediário deixaria o arquivo no meio do caminho");
});

test("planRestore respeita o início do turno", () => {
  const list = [{ absPath: "/p/a", content: "v1" }, { absPath: "/p/a", content: "v2" }];
  assert.equal(planRestore(list, 1)[0].content, "v2");
});

// --- integração --------------------------------------------------------------

/** Simula dois turnos: cada um marca agent_start e depois edita arquivos. */
async function cenarioDoisTurnos() {
  const cwd = mkdtempSync(join(tmpdir(), "pi-rewind-"));
  const ext = await loadExtension("checkpoint.ts");
  const escolhas = [];
  const avisos = [];
  const forks = [];

  const ctx = makeCtx({
    cwd,
    ui: {
      notify: (msg) => avisos.push(msg),
      confirm: async () => true,
      select: async (_titulo, opcoes) => opcoes[escolhas.shift() ?? 0],
    },
    fork: async (entryId, options) => forks.push({ entryId, options }),
    sessionManager: {
      getLeafId: () => leaf,
      getEntry: (id) => ({ type: "message", message: { role: "user", content: textos[id] } }),
    },
  });

  const textos = { e1: "corrige o parser", e2: "adiciona os testes" };
  let leaf = "e1";

  const editar = async (rel, conteudo) => {
    await ext.events.tool_call({ toolName: "write", input: { path: rel } }, ctx);
    writeFileSync(join(cwd, rel), conteudo);
  };

  writeFileSync(join(cwd, "a.txt"), "original A");
  writeFileSync(join(cwd, "b.txt"), "original B");

  await ext.events.agent_start({}, ctx);
  await editar("a.txt", "turno 1 mexeu em A");
  await editar("b.txt", "turno 1 mexeu em B");

  leaf = "e2";
  await ext.events.agent_start({}, ctx);
  await editar("a.txt", "turno 2 mexeu em A de novo");
  await editar("novo.txt", "criado no turno 2");

  return { ext, ctx, cwd, escolhas, avisos, forks };
}

test("rebobinar o último turno restaura só o que ele mudou", async () => {
  const { ext, ctx, cwd, escolhas, forks } = await cenarioDoisTurnos();
  escolhas.push(0, 1); // turno mais recente; "Só o código"

  await ext.commands.rewind("", ctx);

  assert.equal(readFileSync(join(cwd, "a.txt"), "utf8"), "turno 1 mexeu em A", "A volta ao fim do turno 1, não ao original");
  assert.equal(readFileSync(join(cwd, "b.txt"), "utf8"), "turno 1 mexeu em B", "B não foi tocado no turno 2");
  assert.equal(existsSync(join(cwd, "novo.txt")), false, "arquivo criado no turno 2 é removido");
  assert.deepEqual(forks, [], '"Só o código" não pode mexer na conversa');
});

test("rebobinar o primeiro turno volta tudo ao original", async () => {
  const { ext, ctx, cwd, escolhas } = await cenarioDoisTurnos();
  escolhas.push(1, 1); // turno mais antigo; "Só o código"

  await ext.commands.rewind("", ctx);

  assert.equal(readFileSync(join(cwd, "a.txt"), "utf8"), "original A");
  assert.equal(readFileSync(join(cwd, "b.txt"), "utf8"), "original B");
  assert.equal(existsSync(join(cwd, "novo.txt")), false);
});

test('"ambos" restaura código e faz fork da conversa', async () => {
  const { ext, ctx, cwd, escolhas, forks } = await cenarioDoisTurnos();
  escolhas.push(0, 0); // turno mais recente; "Código e conversa"

  await ext.commands.rewind("", ctx);

  assert.equal(readFileSync(join(cwd, "a.txt"), "utf8"), "turno 1 mexeu em A");
  assert.deepEqual(forks, [{ entryId: "e2", options: { position: "before" } }]);
});

test('"só a conversa" não toca nos arquivos', async () => {
  const { ext, ctx, cwd, escolhas, forks } = await cenarioDoisTurnos();
  escolhas.push(0, 2); // turno mais recente; "Só a conversa"

  await ext.commands.rewind("", ctx);

  assert.equal(readFileSync(join(cwd, "a.txt"), "utf8"), "turno 2 mexeu em A de novo");
  assert.equal(forks.length, 1);
});

test("o seletor usa a mensagem do usuário como rótulo", async () => {
  const { ext, ctx, escolhas } = await cenarioDoisTurnos();
  const titulos = [];
  ctx.ui.select = async (titulo, opcoes) => {
    titulos.push({ titulo, opcoes });
    return opcoes[escolhas.shift() ?? 0];
  };
  escolhas.push(0, 1);

  await ext.commands.rewind("", ctx);

  assert.match(titulos[0].opcoes[0], /adiciona os testes/, "mais recente primeiro");
  assert.match(titulos[0].opcoes[1], /corrige o parser/);
});

test("cancelar no seletor não muda nada", async () => {
  const { ext, ctx, cwd } = await cenarioDoisTurnos();
  ctx.ui.select = async (_t, opcoes) => opcoes[opcoes.length - 1]; // "Cancelar"

  await ext.commands.rewind("", ctx);
  assert.equal(readFileSync(join(cwd, "a.txt"), "utf8"), "turno 2 mexeu em A de novo");
});

test("sem edições, /rewind avisa em vez de quebrar", async () => {
  const ext = await loadExtension("checkpoint.ts");
  const avisos = [];
  const ctx = makeCtx({ ui: { notify: (msg) => avisos.push(msg) } });

  await ext.commands.rewind("", ctx);
  assert.match(avisos.join("\n"), /nada para rebobinar/i);
});

test("/undo continua desfazendo uma edição só", async () => {
  const { ext, ctx, cwd } = await cenarioDoisTurnos();

  await ext.commands.undo("", ctx);

  assert.equal(existsSync(join(cwd, "novo.txt")), false, "desfaz a última edição");
  assert.equal(readFileSync(join(cwd, "a.txt"), "utf8"), "turno 2 mexeu em A de novo", "e só ela");
});
