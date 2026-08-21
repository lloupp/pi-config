// checkpoint.ts: /undo precisa devolver o arquivo exatamente como estava. A versão
// anterior lia e gravava como utf8, então todo byte inválido em UTF-8 voltava como
// caractere de substituição — o undo destruía o arquivo que deveria restaurar.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadExtension, makeCtx } from "./harness.mjs";

/**
 * Cada teste ganha uma instância própria da extensão e um projeto vazio: os checkpoints
 * vivem em memória dentro da factory, então instâncias compartilhadas vazariam estado
 * (ids e snapshots) de um teste para o outro.
 */
async function novoAmbiente() {
  const ext = await loadExtension("checkpoint.ts");
  const avisos = [];
  const ctx = makeCtx({
    cwd: mkdtempSync(join(tmpdir(), "pi-checkpoint-")),
    ui: { notify: (msg) => avisos.push(msg) },
  });

  /** Simula uma edição do agente: snapshot antes, escrita depois. */
  async function editar(relPath, novoConteudo) {
    await ext.events.tool_call({ toolName: "write", input: { path: relPath } }, ctx);
    writeFileSync(join(ctx.cwd, relPath), novoConteudo);
  }

  return { ext, ctx, avisos, editar, caminho: (rel) => join(ctx.cwd, rel) };
}

test("undo restaura arquivo binário byte a byte", async () => {
  const { ext, ctx, editar, caminho } = await novoAmbiente();
  // Cabeçalho PNG mais bytes que não formam UTF-8 válido.
  const original = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0x00, 0x80, 0xc3, 0x28]);
  writeFileSync(caminho("icone.png"), original);

  await editar("icone.png", Buffer.from("sobrescrito pelo agente"));
  await ext.commands.undo("", ctx);

  assert.deepEqual(readFileSync(caminho("icone.png")), original);
});

test("undo restaura texto acentuado sem alterar bytes", async () => {
  const { ext, ctx, editar, caminho } = await novoAmbiente();
  const original = "Ação: configuração não-ASCII — çãõ\n";
  writeFileSync(caminho("nota.md"), original, "utf8");

  await editar("nota.md", "destruído");
  await ext.commands.undo("", ctx);

  assert.equal(readFileSync(caminho("nota.md"), "utf8"), original);
});

test("undo apaga arquivo que não existia antes da edição", async () => {
  const { ext, ctx, editar, caminho } = await novoAmbiente();

  await editar("novo.txt", "criado agora");
  await ext.commands.undo("", ctx);

  assert.equal(existsSync(caminho("novo.txt")), false);
});

test("undos sucessivos voltam edição por edição", async () => {
  const { ext, ctx, editar, caminho } = await novoAmbiente();
  writeFileSync(caminho("a.txt"), "versao 1", "utf8");

  await editar("a.txt", "versao 2");
  await editar("a.txt", "versao 3");

  await ext.commands.undo("", ctx);
  assert.equal(readFileSync(caminho("a.txt"), "utf8"), "versao 2");

  await ext.commands.undo("", ctx);
  assert.equal(readFileSync(caminho("a.txt"), "utf8"), "versao 1");
});

test("undo por id restaura o checkpoint escolhido", async () => {
  const { ext, ctx, avisos, editar, caminho } = await novoAmbiente();
  writeFileSync(caminho("a.txt"), "versao 1", "utf8");

  await editar("a.txt", "versao 2");
  await editar("a.txt", "versao 3");

  // Descobre o id pelo próprio /checkpoints, em vez de supor a numeração.
  await ext.commands.checkpoints("", ctx);
  const ids = [...avisos.at(-1).matchAll(/#(\d+)/g)].map((m) => Number(m[1])).sort((a, b) => a - b);

  await ext.commands.undo(String(ids[0]), ctx);
  assert.equal(readFileSync(caminho("a.txt"), "utf8"), "versao 1");
});

test("undo sem checkpoints avisa em vez de quebrar", async () => {
  const { ext, ctx, avisos } = await novoAmbiente();

  await ext.commands.undo("", ctx);
  assert.match(avisos.join("\n"), /nenhum checkpoint/i);
});

test("undo com id inexistente avisa", async () => {
  const { ext, ctx, avisos, editar } = await novoAmbiente();
  await editar("x.txt", "conteudo");

  await ext.commands.undo("9999", ctx);
  assert.match(avisos.join("\n"), /não encontrado/i);
});

test("checkpoint de arquivo grande é registrado, mas recusa o undo", async () => {
  const { ext, ctx, avisos, caminho } = await novoAmbiente();
  const alvo = caminho("grande.log");
  writeFileSync(alvo, Buffer.alloc(1_000_001, 0x61));

  await ext.events.tool_call({ toolName: "write", input: { path: "grande.log" } }, ctx);
  writeFileSync(alvo, "truncado pelo agente");

  await ext.commands.undo("", ctx);

  // Sem conteúdo guardado o undo não acontece — mas o usuário precisa saber disso,
  // em vez de descobrir só na hora em que precisar desfazer.
  assert.match(avisos.join("\n"), /grande|desfazer/i);
  assert.equal(readFileSync(alvo, "utf8"), "truncado pelo agente");
});

test("/checkpoints marca o que não tem undo", async () => {
  const { ext, ctx, avisos, caminho } = await novoAmbiente();
  writeFileSync(caminho("grande.log"), Buffer.alloc(1_000_001, 0x61));
  await ext.events.tool_call({ toolName: "write", input: { path: "grande.log" } }, ctx);

  await ext.commands.checkpoints("", ctx);
  assert.match(avisos.at(-1), /sem undo/i);
});
