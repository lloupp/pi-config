// `#` no início da mensagem guarda uma instrução, como no Claude Code. No pi o arquivo que
// o agente lê toda sessão é o AGENTS.md, então é ele que faz o papel do CLAUDE.md.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const agentDir = mkdtempSync(join(tmpdir(), "pi-agent-"));
process.env.PI_CODING_AGENT_DIR = agentDir;

const assert = (await import("node:assert/strict")).default;
const { test } = await import("node:test");
const { loadExtension, makeCtx } = await import("./harness.mjs");

const ext = await loadExtension("persistent-memory.ts");

/** ctx que escolhe sempre a mesma opção do seletor. */
function ctxCom(escolha, cwd = mkdtempSync(join(tmpdir(), "pi-proj-"))) {
  const avisos = [];
  const titulos = [];
  return {
    cwd,
    avisos,
    titulos,
    ctx: makeCtx({
      cwd,
      ui: {
        notify: (msg) => avisos.push(msg),
        select: async (titulo, opcoes) => {
          titulos.push({ titulo, opcoes });
          return typeof escolha === "number" ? opcoes[escolha] : escolha;
        },
      },
    }),
  };
}

test("# grava no AGENTS.md do projeto e não gasta turno", async () => {
  const { ctx, cwd } = ctxCom(0);

  const res = await ext.events.input({ text: "# sempre rodar os testes antes de commitar" }, ctx);

  assert.equal(res.action, "handled", "não pode virar mensagem para o agente");
  const conteudo = readFileSync(join(cwd, "AGENTS.md"), "utf8");
  assert.match(conteudo, /## Memórias/);
  assert.match(conteudo, /- sempre rodar os testes antes de commitar/);
});

test("escolher global grava no AGENTS.md do diretório de configuração", async () => {
  const { ctx } = ctxCom(1);

  await ext.events.input({ text: "# usar português nos comentários" }, ctx);

  assert.match(readFileSync(join(agentDir, "AGENTS.md"), "utf8"), /- usar português nos comentários/);
});

test("mensagem comum passa direto para o agente", async () => {
  const { ctx } = ctxCom(0);
  assert.deepEqual(await ext.events.input({ text: "explique este arquivo" }, ctx), { action: "continue" });
});

test("# sozinho não é tratado como memória", async () => {
  const { ctx } = ctxCom(0);
  // Senão um `#` digitado por engano abriria um seletor do nada.
  assert.deepEqual(await ext.events.input({ text: "#   " }, ctx), { action: "continue" });
});

test("cancelar no seletor não grava nada", async () => {
  const { ctx, cwd } = ctxCom("Cancelar");

  const res = await ext.events.input({ text: "# alguma coisa" }, ctx);

  assert.equal(res.action, "handled");
  assert.throws(() => readFileSync(join(cwd, "AGENTS.md"), "utf8"), /ENOENT/);
});

test("a seção Memórias é reusada, não duplicada", async () => {
  const { ctx, cwd } = ctxCom(0);

  await ext.events.input({ text: "# primeira" }, ctx);
  await ext.events.input({ text: "# segunda" }, ctx);

  const conteudo = readFileSync(join(cwd, "AGENTS.md"), "utf8");
  assert.equal(conteudo.match(/## Memórias/g).length, 1);
  assert.match(conteudo, /- primeira/);
  assert.match(conteudo, /- segunda/);
});

test("o conteúdo que já existia no AGENTS.md sobrevive", async () => {
  const { ctx, cwd } = ctxCom(0);
  writeFileSync(join(cwd, "AGENTS.md"), "# Projeto\n\nInstruções antigas.\n", "utf8");

  await ext.events.input({ text: "# nova instrução" }, ctx);

  const conteudo = readFileSync(join(cwd, "AGENTS.md"), "utf8");
  assert.match(conteudo, /Instruções antigas\./);
  assert.match(conteudo, /- nova instrução/);
});

test("texto com cara de segredo é recusado", async () => {
  const { ctx, cwd, avisos } = ctxCom(0);

  await ext.events.input({ text: "# a chave é api_key=abc123" }, ctx);

  assert.match(avisos.join("\n"), /segredo/i);
  assert.throws(() => readFileSync(join(cwd, "AGENTS.md"), "utf8"), /ENOENT/);
});

test("/remember faz o mesmo que o #", async () => {
  const { ctx, cwd } = ctxCom(0);

  await ext.commands.remember("preferir edits pequenos", ctx);

  assert.match(readFileSync(join(cwd, "AGENTS.md"), "utf8"), /- preferir edits pequenos/);
});

test("/remember sem texto explica o uso", async () => {
  const { ctx, avisos } = ctxCom(0);
  await ext.commands.remember("  ", ctx);
  assert.match(avisos.join("\n"), /Uso: \/remember/);
});
