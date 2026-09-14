import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadExtension, makeCtx } from "./harness.mjs";

async function ambiente() {
  const cwd = mkdtempSync(join(tmpdir(), "pi-rewind-atomic-"));
  const ext = await loadExtension("checkpoint.ts");
  const escolhas = [];
  const avisos = [];
  let leaf = "e1";
  const textos = { e1: "primeiro turno", e2: "segundo turno" };

  const ctx = makeCtx({
    cwd,
    ui: {
      notify: (msg) => avisos.push(msg),
      confirm: async () => true,
      select: async (_titulo, opcoes) => opcoes[escolhas.shift() ?? 0],
    },
    fork: async () => ({ cancelled: false }),
    sessionManager: {
      getLeafId: () => leaf,
      getEntry: (id) => ({ type: "message", message: { role: "user", content: textos[id] } }),
    },
  });

  const editar = async (rel, conteudo) => {
    await ext.events.tool_call({ toolName: "write", input: { path: rel } }, ctx);
    writeFileSync(join(cwd, rel), conteudo);
  };

  writeFileSync(join(cwd, "a.txt"), "original A");
  await ext.events.agent_start({}, ctx);
  await editar("a.txt", "turno 1");

  leaf = "e2";
  await ext.events.agent_start({}, ctx);
  await editar("a.txt", "turno 2");
  await editar("novo.txt", "criado no turno 2");

  return { cwd, ext, ctx, escolhas, avisos };
}

test("falha no fork desfaz a restauração de código e preserva checkpoints", async () => {
  const { cwd, ext, ctx, escolhas, avisos } = await ambiente();
  ctx.fork = async () => {
    throw new Error("fork indisponível");
  };
  escolhas.push(0, 0); // turno mais recente; código e conversa

  await ext.commands.rewind("", ctx);

  assert.equal(readFileSync(join(cwd, "a.txt"), "utf8"), "turno 2");
  assert.equal(readFileSync(join(cwd, "novo.txt"), "utf8"), "criado no turno 2");
  assert.match(avisos.join("\n"), /checkpoints preservados/i);

  // Os checkpoints precisam continuar utilizáveis após a falha.
  ctx.fork = async () => ({ cancelled: false });
  escolhas.push(0, 1); // mesmo turno; só código
  await ext.commands.rewind("", ctx);
  assert.equal(readFileSync(join(cwd, "a.txt"), "utf8"), "turno 1");
  assert.equal(existsSync(join(cwd, "novo.txt")), false);
});

test("snapshot incompleto impede rewind parcial de código", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-rewind-large-"));
  const ext = await loadExtension("checkpoint.ts");
  const avisos = [];
  const escolhas = [0, 1]; // único turno; só código
  const ctx = makeCtx({
    cwd,
    ui: {
      notify: (msg) => avisos.push(msg),
      confirm: async () => true,
      select: async (_titulo, opcoes) => opcoes[escolhas.shift() ?? 0],
    },
    sessionManager: {
      getLeafId: () => "e1",
      getEntry: () => ({ type: "message", message: { role: "user", content: "edita dois arquivos" } }),
    },
  });

  writeFileSync(join(cwd, "grande.bin"), Buffer.alloc(1_000_001, 0x61));
  writeFileSync(join(cwd, "pequeno.txt"), "antes");
  await ext.events.agent_start({}, ctx);

  await ext.events.tool_call({ toolName: "write", input: { path: "grande.bin" } }, ctx);
  writeFileSync(join(cwd, "grande.bin"), "depois");
  await ext.events.tool_call({ toolName: "write", input: { path: "pequeno.txt" } }, ctx);
  writeFileSync(join(cwd, "pequeno.txt"), "depois");

  await ext.commands.rewind("", ctx);

  assert.equal(readFileSync(join(cwd, "grande.bin"), "utf8"), "depois");
  assert.equal(readFileSync(join(cwd, "pequeno.txt"), "utf8"), "depois");
  assert.match(avisos.join("\n"), /nenhum arquivo foi alterado/i);
});
