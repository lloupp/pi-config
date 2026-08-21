// hooks.ts torna configurável no settings.json o que antes exigia escrever uma extensão.
// O ponto delicado é a passagem de valores: eles vão como parâmetros posicionais do shell,
// nunca interpolados no texto do comando — os caminhos vêm do modelo.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const agentDir = mkdtempSync(join(tmpdir(), "pi-agent-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
const settingsFile = join(agentDir, "settings.json");

const assert = (await import("node:assert/strict")).default;
const { test } = await import("node:test");
const { importExtension, loadExtension, makeCtx } = await import("./harness.mjs");

const { selectHooks, subjectOf, loadHooks } = await importExtension("hooks.ts");

const cmd = (command, extra = {}) => ({ type: "command", command, ...extra });

// --- seleção ----------------------------------------------------------------

test("matcher casa a ferramenta por regex", () => {
  const grupos = [{ matcher: "write|edit", hooks: [cmd("formatar")] }];
  assert.equal(selectHooks(grupos, "write").length, 1);
  assert.equal(selectHooks(grupos, "edit").length, 1);
  assert.equal(selectHooks(grupos, "bash").length, 0);
});

test("matcher ancorado não casa por substring", () => {
  // Sem a âncora, um matcher "read" pegaria "spread" ou qualquer tool que contenha o nome.
  assert.equal(selectHooks([{ matcher: "read", hooks: [cmd("x")] }], "readme_tool").length, 0);
});

test("sem matcher ou com * casa qualquer ferramenta", () => {
  assert.equal(selectHooks([{ hooks: [cmd("x")] }], "qualquer").length, 1);
  assert.equal(selectHooks([{ matcher: "*", hooks: [cmd("x")] }], "qualquer").length, 1);
});

test("regex inválida é ignorada em vez de derrubar", () => {
  assert.deepEqual(selectHooks([{ matcher: "(((", hooks: [cmd("x")] }], "write"), []);
});

test("entradas malformadas são descartadas", () => {
  assert.deepEqual(selectHooks(undefined, "write"), []);
  assert.deepEqual(selectHooks([{ hooks: [{ type: "outro", command: "x" }] }], "write"), []);
  assert.deepEqual(selectHooks([{ hooks: [{ type: "command" }] }], "write"), []);
});

test("subjectOf devolve caminho para arquivo e comando para bash", () => {
  assert.equal(subjectOf("write", { path: "src/a.ts" }), "src/a.ts");
  assert.equal(subjectOf("bash", { command: "ls -la" }), "ls -la");
});

test("settings.json inválido devolve config vazia", () => {
  writeFileSync(settingsFile, "{ não é json", "utf8");
  assert.deepEqual(loadHooks(), {});
});

// --- execução ---------------------------------------------------------------

function escreverHooks(hooks) {
  writeFileSync(settingsFile, JSON.stringify({ hooks }, null, 2), "utf8");
}

/** Carrega a extensão capturando o argv de cada exec. */
async function comHooks(hooks, resposta = { stdout: "", stderr: "", code: 0, killed: false }) {
  escreverHooks(hooks);
  const chamadas = [];
  const ext = await loadExtension("hooks.ts", {
    exec: async (cmdName, args, opts) => {
      chamadas.push({ cmd: cmdName, args, opts });
      return typeof resposta === "function" ? resposta(args) : resposta;
    },
  });
  await ext.events.session_start({}, makeCtx());
  return { ext, chamadas };
}

test("o valor vai como parâmetro posicional, não dentro do comando", async () => {
  const { ext, chamadas } = await comHooks({
    PreToolUse: [{ matcher: "write", hooks: [cmd('echo "$3"')] }],
  });

  const perigoso = 'a.ts"; rm -rf ~; echo "';
  await ext.events.tool_call({ toolName: "write", input: { path: perigoso } }, makeCtx({ cwd: "/proj" }));

  const { cmd: binario, args } = chamadas[0];
  assert.equal(binario, "sh");
  assert.equal(args[0], "-c");
  assert.equal(args[1], 'echo "$3"', "o comando precisa chegar literal ao shell");
  assert.deepEqual(args.slice(2), ["pi-hook", "PreToolUse", "write", perigoso]);
});

test("PreToolUse com exit 2 bloqueia a ferramenta", async () => {
  const { ext } = await comHooks({ PreToolUse: [{ hooks: [cmd("recusa")] }] }, {
    stdout: "",
    stderr: "não edite este arquivo",
    code: 2,
    killed: false,
  });

  const res = await ext.events.tool_call({ toolName: "write", input: { path: "a.ts" } }, makeCtx());
  assert.equal(res?.block, true);
  assert.match(res.reason, /não edite este arquivo/);
});

test("exit diferente de 0 e 2 não bloqueia", async () => {
  const { ext } = await comHooks({ PreToolUse: [{ hooks: [cmd("falha")] }] }, {
    stdout: "",
    stderr: "erro qualquer",
    code: 1,
    killed: false,
  });

  assert.equal(await ext.events.tool_call({ toolName: "write", input: { path: "a.ts" } }, makeCtx()), undefined);
});

test("PostToolUse com exit 2 devolve o stderr ao agente", async () => {
  const { ext } = await comHooks({ PostToolUse: [{ matcher: "write", hooks: [cmd("lint")] }] }, {
    stdout: "",
    stderr: "faltou ponto e vírgula na linha 3",
    code: 2,
    killed: false,
  });

  const res = await ext.events.tool_result(
    { toolName: "write", content: [{ type: "text", text: "ok" }] },
    makeCtx(),
  );
  const texto = res.content.map((b) => b.text).join("\n");
  assert.match(texto, /ok/, "o resultado original precisa continuar lá");
  assert.match(texto, /faltou ponto e vírgula/);
});

test("hook que estoura o timeout não bloqueia nem quebra", async () => {
  const { ext } = await comHooks({ PreToolUse: [{ hooks: [cmd("trava")] }] }, {
    stdout: "",
    stderr: "",
    code: 0,
    killed: true,
  });

  assert.equal(await ext.events.tool_call({ toolName: "write", input: { path: "a.ts" } }, makeCtx()), undefined);
});

test("sem hooks configurados nada é executado", async () => {
  const { ext, chamadas } = await comHooks({});
  await ext.events.tool_call({ toolName: "write", input: { path: "a.ts" } }, makeCtx());
  assert.equal(chamadas.length, 0);
});

test("UserPromptSubmit recebe o texto e deixa a mensagem seguir", async () => {
  const { ext, chamadas } = await comHooks({ UserPromptSubmit: [{ hooks: [cmd("registra")] }] });

  const res = await ext.events.input({ text: "faça algo" }, makeCtx());

  assert.deepEqual(res, { action: "continue" });
  assert.deepEqual(chamadas[0].args.slice(2), ["pi-hook", "UserPromptSubmit", "", "faça algo"]);
});

test("Stop dispara ao fim da tarefa", async () => {
  const { ext, chamadas } = await comHooks({ Stop: [{ hooks: [cmd("avisa")] }] });
  await ext.events.agent_settled({}, makeCtx());
  assert.equal(chamadas.length, 1);
});

test("o timeout do hook é respeitado", async () => {
  const { ext, chamadas } = await comHooks({ PreToolUse: [{ hooks: [cmd("x", { timeout: 5 })] }] });
  await ext.events.tool_call({ toolName: "write", input: { path: "a.ts" } }, makeCtx());
  assert.equal(chamadas[0].opts.timeout, 5000);
});
