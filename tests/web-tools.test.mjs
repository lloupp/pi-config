// web-tools.ts: o parser do DuckDuckGo pareava título e trecho por contador, então um
// resultado sem trecho deslocava todos os seguintes e eles passavam a descrever a URL
// errada. O pareamento agora é por posição no HTML.
import assert from "node:assert/strict";
import { test } from "node:test";
import { importExtension } from "./harness.mjs";

const { parseDuckDuckGo } = await importExtension("web-tools.ts");

const resultado = (href, titulo, trecho) =>
  `<div class="result">
    <a class="result__a" href="${href}">${titulo}</a>
    ${trecho ? `<a class="result__snippet">${trecho}</a>` : ""}
  </div>`;

test("cada resultado fica com o próprio trecho", () => {
  const html = [
    resultado("https://um.example/a", "Primeiro", "trecho do primeiro"),
    resultado("https://dois.example/b", "Segundo", "trecho do segundo"),
  ].join("\n");

  const results = parseDuckDuckGo(html, 10);
  assert.equal(results.length, 2);
  assert.equal(results[0].snippet, "trecho do primeiro");
  assert.equal(results[1].snippet, "trecho do segundo");
});

test("resultado sem trecho não rouba o trecho do seguinte", () => {
  const html = [
    resultado("https://um.example/a", "Primeiro", "trecho do primeiro"),
    resultado("https://dois.example/b", "Segundo sem trecho", null),
    resultado("https://tres.example/c", "Terceiro", "trecho do terceiro"),
  ].join("\n");

  const results = parseDuckDuckGo(html, 10);
  assert.equal(results.length, 3);
  assert.equal(results[0].snippet, "trecho do primeiro");
  assert.equal(results[1].snippet, "", "resultado sem trecho deve ficar vazio");
  assert.equal(results[2].snippet, "trecho do terceiro", "o trecho não pode escorregar para o resultado anterior");
});

test("respeita o limite pedido", () => {
  const html = Array.from({ length: 8 }, (_, i) =>
    resultado(`https://ex${i}.example/`, `Titulo ${i}`, `trecho ${i}`),
  ).join("\n");

  const results = parseDuckDuckGo(html, 3);
  assert.equal(results.length, 3);
  assert.equal(results[2].snippet, "trecho 2");
});

test("desembrulha o redirecionador do DuckDuckGo", () => {
  const alvo = "https://destino.example/pagina?x=1";
  const html = resultado(`//duckduckgo.com/l/?uddg=${encodeURIComponent(alvo)}`, "Titulo", "trecho");

  const [primeiro] = parseDuckDuckGo(html, 5);
  assert.equal(primeiro.url, alvo);
});

test("HTML sem resultados devolve lista vazia", () => {
  assert.deepEqual(parseDuckDuckGo("<html><body>nada aqui</body></html>", 5), []);
});

test("entidades HTML do título são decodificadas", () => {
  const html = resultado("https://ex.example/", "Fun&#231;&#227;o &amp; testes &lt;b&gt;", "trecho");
  const [primeiro] = parseDuckDuckGo(html, 5);
  assert.equal(primeiro.title, "Função & testes <b>");
});
