// persistent-memory.ts e error-lessons.ts são quase gêmeos e tinham filtros de escopo
// divergentes por acidente: a busca de lições dizia "padrão repo" na descrição mas não
// filtrava nada. Cada um agora tem um padrão deliberado e documentado.
//
// HOME aponta para um diretório temporário — os stores gravam em ~/.pi/agent/memory.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.HOME = mkdtempSync(join(tmpdir(), "pi-home-"));

const { loadExtension, makeCtx, contentText } = await import("./harness.mjs");
const assert = (await import("node:assert/strict")).default;
const { test, before } = await import("node:test");

const memoria = (await loadExtension("persistent-memory.ts")).tools.persistent_memory;
const licoes = (await loadExtension("error-lessons.ts")).tools.error_lessons;

const alpha = makeCtx({ cwd: "/proj/alpha" });
const beta = makeCtx({ cwd: "/proj/beta" });

const chamar = (tool, params, ctx) => tool.execute("id", params, null, null, ctx);

before(async () => {
  await chamar(memoria, { action: "add", text: "memoria do alpha" }, alpha);
  await chamar(memoria, { action: "add", text: "memoria do beta" }, beta);
  await chamar(memoria, { action: "add", text: "memoria global", scope: "global" }, alpha);

  await chamar(licoes, { action: "add", error: "falha no alpha", lesson: "licao do alpha" }, alpha);
  await chamar(licoes, { action: "add", error: "falha no beta", lesson: "licao do beta" }, beta);
});

test("persistent_memory: por padrão mostra só o repo atual", async () => {
  const texto = contentText(await chamar(memoria, { action: "list" }, beta));
  assert.match(texto, /beta/);
  assert.doesNotMatch(texto, /alpha/);
});

test("persistent_memory: scope=all atravessa os repos", async () => {
  const texto = contentText(await chamar(memoria, { action: "list", scope: "all" }, beta));
  assert.match(texto, /alpha/);
  assert.match(texto, /beta/);
});

test("persistent_memory: scope=global traz só as globais", async () => {
  const texto = contentText(await chamar(memoria, { action: "list", scope: "global" }, beta));
  assert.match(texto, /global/);
  assert.doesNotMatch(texto, /memoria do beta/);
});

test("error_lessons: por padrão varre todos os repos", async () => {
  // Uma lição aprendida num projeto costuma valer nos outros — este é o padrão declarado
  // na descrição do parâmetro.
  const texto = contentText(await chamar(licoes, { action: "list" }, beta));
  assert.match(texto, /alpha/);
  assert.match(texto, /beta/);
});

test("error_lessons: scope=repo restringe ao repo atual", async () => {
  const texto = contentText(await chamar(licoes, { action: "list", scope: "repo" }, beta));
  assert.match(texto, /beta/);
  assert.doesNotMatch(texto, /alpha/);
});

test("busca encontra pelo termo", async () => {
  const texto = contentText(await chamar(licoes, { action: "search", query: "alpha" }, beta));
  assert.match(texto, /licao do alpha/);
});

test("os dois recusam salvar algo com cara de segredo", async () => {
  await assert.rejects(
    () => chamar(memoria, { action: "add", text: "api_key=abc123" }, alpha),
    /segredo/i,
  );
  await assert.rejects(
    () => chamar(licoes, { action: "add", error: "erro", lesson: "use o token sk-abc123" }, alpha),
    /segredo/i,
  );
});

test("forget remove e avisa quando o id não existe", async () => {
  const criada = await chamar(memoria, { action: "add", text: "memoria efemera" }, alpha);
  const id = criada.details.item.id;

  assert.match(contentText(await chamar(memoria, { action: "forget", id }, alpha)), /removida/i);
  assert.match(contentText(await chamar(memoria, { action: "forget", id: 999_999 }, alpha)), /não encontrada/i);
});
