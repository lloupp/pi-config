// safety-guard.ts: os handlers de tool_call rodam junto com o batch de tool calls, então
// dois comandos perigosos abriam dois dialogs ao mesmo tempo. A TUI tem um slot único de
// dialog: o primeiro nunca resolvia e o turno travava. Os dialogs agora são serializados.
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadExtension, makeCtx } from "./harness.mjs";

const ext = await loadExtension("safety-guard.ts");
const onToolCall = ext.events.tool_call;

/** Contexto que registra quantos dialogs ficam abertos simultaneamente. */
function ctxComDialogs({ aprovar = true, duracaoMs = 30 } = {}) {
  const estado = { abertos: 0, pico: 0, total: 0 };
  const ctx = makeCtx({
    cwd: "/proj",
    ui: {
      async confirm() {
        estado.total++;
        estado.abertos++;
        estado.pico = Math.max(estado.pico, estado.abertos);
        await new Promise((r) => setTimeout(r, duracaoMs));
        estado.abertos--;
        return aprovar;
      },
    },
  });
  return { ctx, estado };
}

const bash = (ctx, command) => onToolCall({ toolName: "bash", input: { command } }, ctx);

test("dialogs concorrentes são serializados", async () => {
  const { ctx, estado } = ctxComDialogs();
  const comandos = ["rm -rf /tmp/a", "rm -rf /tmp/b", "git reset --hard", "chmod -R 777 /tmp/c"];

  const resultados = await Promise.all(comandos.map((cmd) => bash(ctx, cmd)));

  assert.equal(estado.total, comandos.length, "todo comando perigoso deve pedir confirmação");
  assert.equal(estado.pico, 1, `nunca pode haver dois dialogs abertos ao mesmo tempo (pico: ${estado.pico})`);
  assert.equal(resultados.length, comandos.length, "todas as chamadas precisam resolver");
});

test("comando aprovado pelo usuário passa", async () => {
  const { ctx } = ctxComDialogs({ aprovar: true });
  assert.equal(await bash(ctx, "rm -rf build/"), undefined);
});

test("comando recusado pelo usuário é bloqueado", async () => {
  const { ctx } = ctxComDialogs({ aprovar: false });
  const res = await bash(ctx, "rm -rf build/");
  assert.equal(res?.block, true);
});

test("comando comum não abre dialog", async () => {
  const { ctx, estado } = ctxComDialogs();
  assert.equal(await bash(ctx, "ls -la"), undefined);
  assert.equal(estado.total, 0);
});

test("leitura de arquivo sensível via bash pede confirmação", async () => {
  const { ctx, estado } = ctxComDialogs();
  await bash(ctx, "cat .env");
  assert.equal(estado.total, 1);
});

test("sem UI, o comando perigoso é bloqueado em vez de travar", async () => {
  const ctx = makeCtx({ cwd: "/proj", hasUI: false });
  const res = await bash(ctx, "rm -rf /tmp/x");
  assert.equal(res?.block, true);
  assert.match(res.reason, /sem UI/i);
});

test("leitura direta de arquivo sensível pede confirmação", async () => {
  const { ctx, estado } = ctxComDialogs();
  await onToolCall({ toolName: "read", input: { path: "/home/user/.ssh/id_rsa" } }, ctx);
  assert.equal(estado.total, 1);
});
