// Toda extensão do repo precisa carregar e registrar o que promete. Pega erro de
// sintaxe, import quebrado e default export ausente — que em uso normal só apareceriam
// como uma extensão silenciosamente ausente na sessão.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import { extensionsDir, loadExtension } from "./harness.mjs";

const files = readdirSync(extensionsDir, { withFileTypes: true })
  .flatMap((entry) => {
    if (entry.isFile() && entry.name.endsWith(".ts")) return [entry.name];
    if (entry.isDirectory() && existsSync(join(extensionsDir, entry.name, "index.ts"))) {
      return [join(entry.name, "index.ts")];
    }
    return [];
  })
  .sort();

test("há extensões para carregar", () => {
  assert.ok(files.length > 0, "nenhum ponto de entrada encontrado em extensions/");
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
