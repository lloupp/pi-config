import assert from "node:assert/strict";
import { test } from "node:test";
import { importExtension, loadExtension, makeCtx } from "./harness.mjs";

const { Observatory, MAX_CALLS, starsFor } = await importExtension("observatorio/model.ts");
const { ObservatoryView } = await importExtension("observatorio/view.ts");

test("observatório correlaciona chamadas paralelas sem guardar argumentos privados", () => {
  const model = new Observatory("/project");
  model.start("read", "read", { path: "app.ts" }, 10);
  model.start("write", "write", { path: "./app.ts", content: "PRIVATE" }, 20);
  model.start("bash", "bash", { command: "echo PRIVATE" }, 20);
  model.finish("write", "write", true, 30);
  model.finish("read", "read", false, 50);
  assert.deepEqual(model.calls.slice(0, 2).map(call => [call.outcome, call.durationMs]), [["success", 40], ["error", 10]]);
  const [star] = starsFor(model.calls);
  assert.equal(star.reads, 1);
  assert.equal(star.changes, 0);
  assert.equal(star.errors, 1);
  assert.equal(JSON.stringify(model.calls).includes("PRIVATE"), false);
});

test("observatório preserva caminhos no limite e reconstrói só o ramo escolhido", () => {
  const model = new Observatory("/project");
  const count = MAX_CALLS + 5;
  const calls = Array.from({ length: count }, (_, i) => ({ type: "toolCall", id: String(i), name: "read", arguments: { path: `file-${i}.ts` } }));
  const results = calls.map(call => ({ type: "message", message: { role: "toolResult", toolCallId: call.id, toolName: "read", isError: false } }));
  model.rebuild([{ type: "message", message: { role: "assistant", content: calls } }, ...results], "/project");
  assert.equal(model.calls.length, MAX_CALLS);
  assert.equal(model.calls[0].id, "5");
  assert.ok(model.calls.every(call => call.file && call.outcome === "success" && call.durationMs === undefined));
  model.rebuild([], "/another-project", false);
  assert.deepEqual(model.calls, []);
});

test("/observatorio abre o código do repo, acompanha resultados e fecha na troca de ramo", async () => {
  const extension = await loadExtension("observatorio/index.ts");
  let component;
  const statuses = [];
  const ctx = makeCtx({
    ui: {
      setStatus: (_key, value) => statuses.push(value),
      custom: factory => new Promise(resolve => {
        component = factory({ terminal: { rows: 32 }, requestRender() {} }, ctx.ui.theme, {}, resolve);
      }),
    },
  });
  await extension.events.session_start({}, ctx);
  await extension.events.tool_execution_start({ toolCallId: "a", toolName: "read", args: { path: "app.ts" } }, ctx);
  const opened = extension.commands.observatorio("", ctx);
  try {
    assert.match(component.render(80).join("\n"), /em execução/);
    await extension.events.tool_execution_end({ toolCallId: "a", toolName: "read", isError: true }, ctx);
    assert.match(component.render(80).join("\n"), /1 arquivos · 1 chamadas · 1 falhas/);
    component.handleInput("r");
    assert.match(component.render(80).join("\n"), /REPLAY 1\/1 PAUSADO/);
    component.handleInput("v");
    assert.match(component.render(80).join("\n"), /AO VIVO/);
    await extension.events.session_tree({}, ctx);
    await opened;
    assert.match(statuses.at(-1), /0 arq · 0 ops/);
  } finally {
    component?.dispose();
    await extension.events.session_shutdown({}, ctx);
    await opened;
  }
  assert.equal(statuses.at(-1), undefined);
});

test("observatório adapta a tela estreita e encerra timers ao pausar ou fechar", () => {
  const model = new Observatory("/project");
  model.start("a", "read", { path: "ação/日本語.ts" }, 0);
  let timers = 0;
  let closed = false;
  const ctx = makeCtx();
  const view = new ObservatoryView(model, {
    theme: ctx.ui.theme, height: () => 21, redraw() {}, close: () => { closed = true; },
    schedule: () => { timers++; return () => { timers--; }; },
  });
  try {
    const lines = view.render(38);
    assert.ok(lines.length <= 21);
    assert.match(lines.join("\n"), /Esc sai/);
    assert.equal(timers, 1);
    view.handleInput(" ");
    assert.equal(timers, 0);
    view.handleInput("v");
    assert.equal(timers, 1);
    view.handleInput("q");
    assert.equal(timers, 0);
    assert.equal(closed, true);
  } finally {
    view.dispose();
  }
});

test("mapa mostra as estrelas usadas por último, não as vistas por último", () => {
  const model = new Observatory("/project");
  for (let i = 0; i < 40; i++) {
    model.start(String(i), "read", { path: `f${i}.ts` }, 0);
    model.finish(String(i), "read", false, 0);
  }
  model.start("old", "edit", { path: "f0.ts" }, 0);
  model.finish("old", "edit", true, 0);
  const ctx = makeCtx();
  const view = new ObservatoryView(model, { theme: ctx.ui.theme, height: () => 22, redraw() {}, close() {}, schedule: () => () => {} });
  try {
    view.handleInput("\x1b[A"); // seleciona outra estrela para f0 não entrar só por estar selecionado
    const lines = view.render(40);
    const map = lines.slice(3, lines.findIndex(line => /✦ \d+\/\d+/.test(line))).join("\n");
    assert.match(map, /!/, "f0.ts, com falha recente, precisa aparecer no mapa");
  } finally {
    view.dispose();
  }
});

test("detalhe mostra as últimas três chamadas da estrela, da mais nova para a mais velha", () => {
  const model = new Observatory("/project");
  ["read", "edit", "read", "write"].forEach((tool, i) => {
    model.start(String(i), tool, { path: "app.ts" }, i * 10);
    model.finish(String(i), tool, tool === "edit", i * 10 + 5);
  });
  const ctx = makeCtx();
  const view = new ObservatoryView(model, { theme: ctx.ui.theme, height: () => 30, redraw() {}, close() {}, schedule: () => () => {} });
  try {
    const text = view.render(80).join("\n");
    assert.match(text, /write: concluída · 5 ms[\s\S]*read: concluída · 5 ms[\s\S]*edit: falhou · 5 ms/);
    assert.equal((text.match(/: (concluída|falhou) · /g) ?? []).length, 3);
  } finally {
    view.dispose();
  }
});
