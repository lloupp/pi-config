// Toda extensão do repo precisa carregar e registrar o que promete. Pega erro de
// sintaxe, import quebrado e default export ausente — que em uso normal só apareceriam
// como uma extensão silenciosamente ausente na sessão.
import { readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { extensionsDir, loadExtension } from "./harness.mjs";

const files = readdirSync(extensionsDir)
  .filter((name) => name.endsWith(".ts"))
  .sort();

test("há extensões para carregar", () => {
  assert.ok(files.length > 0, "nenhum arquivo .ts encontrado em extensions/");
});

for (const file of files) {
  test(`${file} carrega`, async () => {
    const registered = await loadExtension(file);
    const total =
      Object.keys(registered.events).length +
      Object.keys(registered.commands).length +
      Object.keys(registered.tools).length +
      registered.providers.length;
    assert.ok(total > 0, `${file} carregou mas não registrou nada`);
  });
}
