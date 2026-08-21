// subagent ganhou tipos nomeados lidos de agents/*.md, como os subagent_type do Claude
// Code. PI_CODING_AGENT_DIR aponta para um diretório temporário para não depender dos
// tipos instalados na máquina.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const agentDir = mkdtempSync(join(tmpdir(), "pi-agent-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
mkdirSync(join(agentDir, "agents"), { recursive: true });
writeFileSync(
  join(agentDir, "agents", "revisor.md"),
  `---
name: revisor
description: Revisa procurando bugs
tools: read, grep
model: algum/modelo-grande
thinking: high
---

Procure defeitos de correção e relate arquivo e linha.
`,
  "utf8",
);

const assert = (await import("node:assert/strict")).default;
const { test } = await import("node:test");
const { importExtension, loadExtension, makeCtx } = await import("./harness.mjs");

const { parseAgentFile, discoverAgents } = await importExtension("subagent.ts");

// --- frontmatter ------------------------------------------------------------

test("lê o frontmatter no formato do Claude Code", () => {
  const agent = parseAgentFile(
    "---\nname: x\ndescription: faz coisas\ntools: read, grep\nmodel: m/1\n---\n\nCorpo do prompt.",
    "arquivo",
  );
  assert.equal(agent.name, "x");
  assert.equal(agent.description, "faz coisas");
  assert.deepEqual(agent.tools, ["read", "grep"]);
  assert.equal(agent.model, "m/1");
  assert.equal(agent.prompt, "Corpo do prompt.");
});

test("sem name, usa o nome do arquivo", () => {
  assert.equal(parseAgentFile("---\ndescription: y\n---\ncorpo", "meu-agente").name, "meu-agente");
});

test("aceita tools em lista entre colchetes e com aspas", () => {
  const agent = parseAgentFile('---\nname: x\ntools: [read, grep]\ndescription: "com aspas"\n---\n', "f");
  assert.deepEqual(agent.tools, ["read", "grep"]);
  assert.equal(agent.description, "com aspas");
});

test("arquivo sem frontmatter é ignorado", () => {
  assert.equal(parseAgentFile("só um markdown comum", "f"), undefined);
});

// --- descoberta -------------------------------------------------------------

test("descobre os tipos do diretório junto com os embutidos", () => {
  const agents = discoverAgents();
  assert.ok(agents.explore, "explore continua existindo (skills dependem dele)");
  assert.ok(agents.full, "full continua existindo");
  assert.equal(agents.revisor.model, "algum/modelo-grande");
  assert.deepEqual(agents.explore.tools, ["read", "grep", "find", "ls"]);
});

test("o tipo do projeto tem precedência sobre o global", () => {
  const projeto = mkdtempSync(join(tmpdir(), "pi-proj-"));
  mkdirSync(join(projeto, ".pi", "agent", "agents"), { recursive: true });
  writeFileSync(
    join(projeto, ".pi", "agent", "agents", "revisor.md"),
    "---\nname: revisor\ndescription: versão do projeto\n---\ncorpo\n",
    "utf8",
  );
  assert.equal(discoverAgents(projeto).revisor.description, "versão do projeto");
});

// --- execução ---------------------------------------------------------------

/** Captura o argv passado ao `pi` em vez de rodar um subprocesso de verdade. */
async function comExecCapturado({ code = 0, stdout = "resposta do subagente", killed = false } = {}) {
  const chamadas = [];
  const ext = await loadExtension("subagent.ts", {
    exec: async (cmd, args) => {
      chamadas.push({ cmd, args });
      return { stdout, stderr: "erro do subagente", code, killed };
    },
  });
  return { ext, chamadas };
}

test("o tipo define ferramentas, modelo e thinking no argv", async () => {
  const { ext, chamadas } = await comExecCapturado();

  await ext.tools.subagent.execute("id", { task: "revise isto", subagent_type: "revisor" }, null, null, makeCtx({ cwd: "/proj" }));

  const { cmd, args } = chamadas[0];
  assert.equal(cmd, "pi");
  assert.deepEqual(args.slice(0, 2), ["-p", "--no-session"]);
  assert.equal(args[args.indexOf("--tools") + 1], "read,grep");
  assert.equal(args[args.indexOf("--model") + 1], "algum/modelo-grande");
  assert.equal(args[args.indexOf("--thinking") + 1], "high");
});

test("o corpo do markdown vira prompt de sistema do subagente", async () => {
  const { ext, chamadas } = await comExecCapturado();

  await ext.tools.subagent.execute("id", { task: "revise o parser", subagent_type: "revisor" }, null, null, makeCtx());

  const { args } = chamadas[0];
  // --append e não --system-prompt: substituir apagaria o prompt que ensina a usar as tools.
  assert.match(args[args.indexOf("--append-system-prompt") + 1], /Procure defeitos de correção/);
  assert.equal(args.at(-1), "revise o parser", "a tarefa continua sendo o último argumento");
});

test("tipo sem corpo não passa prompt de sistema", async () => {
  const { ext, chamadas } = await comExecCapturado();
  await ext.tools.subagent.execute("id", { task: "x", subagent_type: "explore" }, null, null, makeCtx());
  assert.equal(chamadas[0].args.includes("--append-system-prompt"), false);
});

test("params explícitos sobrepõem o que o tipo define", async () => {
  const { ext, chamadas } = await comExecCapturado();

  await ext.tools.subagent.execute(
    "id",
    { task: "x", subagent_type: "revisor", model: "outro/modelo", provider: "openrouter" },
    null,
    null,
    makeCtx(),
  );

  const { args } = chamadas[0];
  assert.equal(args[args.indexOf("--model") + 1], "outro/modelo");
  assert.equal(args[args.indexOf("--provider") + 1], "openrouter");
});

test("explore é o padrão e limita as ferramentas", async () => {
  const { ext, chamadas } = await comExecCapturado();

  await ext.tools.subagent.execute("id", { task: "onde fica X?" }, null, null, makeCtx());

  const { args } = chamadas[0];
  assert.equal(args[args.indexOf("--tools") + 1], "read,grep,find,ls");
  assert.equal(args.includes("--model"), false, "sem modelo definido, usa o da sessão");
});

test("full não restringe ferramentas", async () => {
  const { ext, chamadas } = await comExecCapturado();

  await ext.tools.subagent.execute("id", { task: "x", subagent_type: "full" }, null, null, makeCtx());
  assert.equal(chamadas[0].args.includes("--tools"), false);
});

test("timeout do subagente vira erro explícito", async () => {
  const { ext } = await comExecCapturado({ killed: true });
  await assert.rejects(
    () => ext.tools.subagent.execute("id", { task: "x" }, null, null, makeCtx()),
    /timeout/i,
  );
});

test("saída do subagente é truncada", async () => {
  const { ext } = await comExecCapturado({ stdout: "z".repeat(40_000) });
  const res = await ext.tools.subagent.execute("id", { task: "x" }, null, null, makeCtx());
  assert.equal(res.details.truncated, true);
  assert.ok(res.details.chars <= 30_100);
});

test("subagent_type desconhecido falha com a lista de opções", async () => {
  const ext = await loadExtension("subagent.ts");
  await assert.rejects(
    () => ext.tools.subagent.execute("id", { task: "x", subagent_type: "inexistente" }, null, null, makeCtx()),
    /desconhecido.*revisor|revisor.*desconhecido/s,
  );
});

test("task vazia é recusada antes de qualquer execução", async () => {
  const ext = await loadExtension("subagent.ts");
  await assert.rejects(
    () => ext.tools.subagent.execute("id", { task: "   " }, null, null, makeCtx()),
    /task é obrigatória/,
  );
});

test("mode continua funcionando como nome antigo de subagent_type", async () => {
  const ext = await loadExtension("subagent.ts");
  // As skills orchestrator e self-debate ainda usam mode=explore.
  await assert.rejects(
    () => ext.tools.subagent.execute("id", { task: "x", mode: "inexistente" }, null, null, makeCtx()),
    /desconhecido/,
  );
});

test("a descrição da tool lista os tipos disponíveis", async () => {
  const ext = await loadExtension("subagent.ts");
  assert.match(ext.tools.subagent.description, /revisor/);
  assert.match(ext.tools.subagent.description, /explore/);
});
