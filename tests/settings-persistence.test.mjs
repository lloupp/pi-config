// /autocheck e /notify se perdiam a cada reload porque o estado só existia em memória:
// o usuário desligava, a sessão reiniciava e a extensão voltava ligada sem avisar. Agora
// os ajustes moram no settings.json, como o resto da configuração.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const agentDir = mkdtempSync(join(tmpdir(), "pi-agent-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
const settingsFile = join(agentDir, "settings.json");

const assert = (await import("node:assert/strict")).default;
const { test } = await import("node:test");
const { loadExtension, makeCtx } = await import("./harness.mjs");

const ler = () => JSON.parse(readFileSync(settingsFile, "utf8"));

test("/autocheck off grava no settings.json e vale na sessão seguinte", async () => {
  writeFileSync(settingsFile, JSON.stringify({ theme: "termux-neon" }, null, 2), "utf8");
  const ext = await loadExtension("auto-check.ts");
  const ctx = makeCtx({ ui: { notify: () => {} } });

  await ext.commands.autocheck("off", ctx);

  assert.equal(ler().autoCheck.enabled, false);
  assert.equal(ler().theme, "termux-neon", "o resto do settings.json precisa sobreviver");

  // Sessão nova: sem verificação, o tool_result passa intocado.
  const nova = await loadExtension("auto-check.ts");
  const res = await nova.events.tool_result(
    { toolName: "write", input: { path: "x.js" }, content: [{ type: "text", text: "ok" }] },
    makeCtx(),
  );
  assert.equal(res, undefined);
});

test("/autocheck on volta a ligar e persiste", async () => {
  writeFileSync(settingsFile, JSON.stringify({ autoCheck: { enabled: false } }, null, 2), "utf8");
  const ext = await loadExtension("auto-check.ts");

  await ext.commands.autocheck("on", makeCtx({ ui: { notify: () => {} } }));
  assert.equal(ler().autoCheck.enabled, true);
});

test("/notify guarda o limiar em segundos", async () => {
  writeFileSync(settingsFile, "{}", "utf8");
  const ext = await loadExtension("notify-done.ts");

  await ext.commands.notify("30", makeCtx({ ui: { notify: () => {} } }));

  assert.deepEqual(ler().notify, { enabled: true, thresholdSeconds: 30 });
});

test("o limiar gravado é lido na sessão seguinte", async () => {
  writeFileSync(settingsFile, JSON.stringify({ notify: { enabled: true, thresholdSeconds: 1 } }, null, 2), "utf8");
  const ext = await loadExtension("notify-done.ts");
  const avisos = [];

  await ext.commands.notify("", makeCtx({ ui: { notify: (msg) => avisos.push(msg) } }));

  // Alternou para desligado, mas o limiar veio do arquivo, não do padrão de 90s.
  assert.match(avisos.join("\n"), /limiar 1s/);
});

test("settings.json ausente cai nos padrões sem quebrar", async () => {
  const vazio = mkdtempSync(join(tmpdir(), "pi-agent-vazio-"));
  const anterior = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = vazio;
  try {
    const ext = await loadExtension("notify-done.ts");
    const avisos = [];
    await ext.commands.notify("", makeCtx({ ui: { notify: (msg) => avisos.push(msg) } }));
    assert.match(avisos.join("\n"), /limiar 90s/);
  } finally {
    process.env.PI_CODING_AGENT_DIR = anterior;
  }
});
