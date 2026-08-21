// mcp.ts: o teto de caracteres valia por bloco de content, não pelo resultado inteiro —
// um servidor que devolvesse dezenas de blocos entregava megabytes ao contexto de uma vez.
import assert from "node:assert/strict";
import { test } from "node:test";
import { importExtension } from "./harness.mjs";

const { convertContent } = await importExtension("mcp.ts");

const MAX = 50_000;
const totalChars = (out) => out.content.reduce((soma, bloco) => soma + (bloco.text?.length ?? 0), 0);

test("resultado com muitos blocos respeita o teto agregado", () => {
  const trinta = { content: Array.from({ length: 30 }, () => ({ type: "text", text: "x".repeat(40_000) })) };
  const out = convertContent(trinta);

  // Sem o orçamento compartilhado seriam 1.200.000 caracteres.
  assert.ok(
    totalChars(out) < MAX * 1.5,
    `esperava algo perto de ${MAX}, veio ${totalChars(out)} caracteres`,
  );
});

test("blocos omitidos são anunciados no resultado", () => {
  const muitos = { content: Array.from({ length: 20 }, () => ({ type: "text", text: "y".repeat(30_000) })) };
  const texto = convertContent(muitos)
    .content.map((b) => b.text ?? "")
    .join("\n");

  assert.match(texto, /omitido/i, "o modelo precisa saber que faltou conteúdo");
});

test("resultado pequeno passa intacto", () => {
  const out = convertContent({ content: [{ type: "text", text: "alpha" }, { type: "text", text: "beta" }] });
  assert.equal(out.content.length, 2);
  assert.equal(out.content[0].text, "alpha");
  assert.equal(out.content[1].text, "beta");
});

test("bloco único grande é truncado com aviso", () => {
  const out = convertContent({ content: [{ type: "text", text: "z".repeat(MAX + 5_000) }] });
  assert.ok(totalChars(out) <= MAX + 200, `veio ${totalChars(out)} caracteres`);
  assert.match(out.content[0].text, /truncado/i);
});

test("imagem é preservada como bloco próprio", () => {
  const out = convertContent({ content: [{ type: "image", data: "AAAA", mimeType: "image/png" }] });
  assert.equal(out.content[0].type, "image");
  assert.equal(out.content[0].data, "AAAA");
});

test("recurso de texto vira bloco de texto", () => {
  const out = convertContent({ content: [{ type: "resource", resource: { uri: "file://x", text: "conteudo" } }] });
  assert.equal(out.content[0].type, "text");
  assert.equal(out.content[0].text, "conteudo");
});

test("resultado vazio não devolve content vazio", () => {
  const out = convertContent({ content: [] });
  assert.equal(out.content.length, 1);
  assert.match(out.content[0].text, /vazio/i);
});

test("isError do servidor é repassado", () => {
  assert.equal(convertContent({ content: [{ type: "text", text: "falhou" }], isError: true }).isError, true);
  assert.equal(convertContent({ content: [{ type: "text", text: "ok" }] }).isError, false);
});
