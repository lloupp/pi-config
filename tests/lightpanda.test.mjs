import assert from "node:assert/strict";
import { test } from "node:test";
import { importExtension, loadExtension, makeCtx } from "./harness.mjs";

const { buildLightpandaArgs, validateBrowserUrl } = await importExtension("lightpanda.ts");

const ok = (stdout = "") => ({ code: 0, stdout, stderr: "", killed: false });

test("browser_open usa Lightpanda com JS renderizado, limite e bloqueio de rede privada", async () => {
  const calls = [];
  const exec = async (command, args, options) => {
    calls.push({ command, args, options });
    return ok("# Aplicação\n\nConteúdo carregado por JavaScript.");
  };
  const ext = await loadExtension("lightpanda.ts", { exec });

  const result = await ext.tools.browser_open.execute(
    "call-1",
    { url: "https://example.com/app", waitMs: 900, maxChars: 5000, selector: "#app" },
    new AbortController().signal,
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "lightpanda");
  assert.ok(calls[0].args.includes("fetch"));
  assert.ok(calls[0].args.includes("--block-private-networks"));
  assert.ok(calls[0].args.includes("--fail-on-http-error"));
  assert.ok(calls[0].args.includes("markdown"));
  assert.ok(calls[0].args.includes("#app"));
  assert.ok(calls[0].args.includes("900"));
  assert.equal(calls[0].args.at(-1), "https://example.com/app");
  assert.match(result.content[0].text, /CONTEÚDO EXTERNO NÃO CONFIÁVEL/);
  assert.match(result.content[0].text, /Conteúdo carregado por JavaScript/);
});

test("URL não-http é rejeitada antes de executar o browser", async () => {
  let called = false;
  const ext = await loadExtension("lightpanda.ts", {
    exec: async () => {
      called = true;
      return ok();
    },
  });

  await assert.rejects(
    ext.tools.browser_open.execute("call-2", { url: "file:///etc/passwd" }, new AbortController().signal),
    /protocolo não permitido/i,
  );
  assert.equal(called, false);
});

test("URL com credenciais é rejeitada para não vazar segredo em argv", () => {
  assert.throws(() => validateBrowserUrl("https://user:secret@example.com/"), /credenciais|usuário\/senha/i);
});

test("args sempre carregam limites de rede, memória e execução", () => {
  const args = buildLightpandaArgs({ url: "https://example.com/", waitMs: 99999, maxChars: 999999 });
  const valueAfter = (flag) => args[args.indexOf(flag) + 1];

  assert.ok(args.includes("--block-private-networks"));
  assert.equal(valueAfter("--wait-ms"), "8000");
  assert.equal(valueAfter("--http-max-response-size"), "5000000");
  assert.equal(valueAfter("--terminate-ms"), "18000");
  assert.equal(valueAfter("--watchdog-ms"), "10000");
  assert.ok(Number(valueAfter("--dump-max-bytes")) <= 121024);
});

test("binário ausente produz erro de instalação acionável", async () => {
  const ext = await loadExtension("lightpanda.ts", {
    exec: async () => ({ code: 127, stdout: "", stderr: "lightpanda: not found", killed: false }),
  });

  await assert.rejects(
    ext.tools.browser_open.execute("call-3", { url: "https://example.com/" }, new AbortController().signal),
    /LIGHTPANDA_BIN|PATH/i,
  );
});

test("/lightpanda mostra a versão quando o binário está disponível", async () => {
  const avisos = [];
  const ext = await loadExtension("lightpanda.ts", { exec: async () => ok("lightpanda 0.0-test\n") });
  await ext.commands.lightpanda("", makeCtx({ ui: { notify: (msg) => avisos.push(msg) } }));
  assert.match(avisos.join("\n"), /0\.0-test/);
});
