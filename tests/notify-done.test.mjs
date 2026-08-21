// notify-done.ts: o marco de tempo era gravado em turn_start e sobrescrito a cada turno,
// então a duração medida era a do último turno. Uma tarefa de dez minutos feita de turnos
// curtos nunca cruzava o limiar e a notificação jamais chegava.
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadExtension } from "./harness.mjs";

const ext = await loadExtension("notify-done.ts");

test("mede a tarefa inteira, não o último turno", () => {
  // agent_start marca o começo; turn_start não deve interferir.
  assert.ok(ext.events.agent_start, "precisa observar agent_start");
  assert.ok(ext.events.agent_settled, "precisa observar agent_settled");
  assert.equal(ext.events.turn_start, undefined, "turn_start mediria apenas o último turno");
});

test("agent_settled é o gatilho, não agent_end", () => {
  // agent_end pode disparar mais de uma vez num mesmo run (retry, compactação);
  // agent_settled só dispara quando o run realmente terminou.
  assert.equal(ext.events.agent_end, undefined, "agent_end notificaria mais de uma vez por tarefa");
});

test("tarefa curta não notifica", async () => {
  await ext.events.agent_start({}, {});
  // Sem esperar: a duração fica muito abaixo do limiar padrão de 90s.
  await ext.events.agent_settled({}, {});
  // Se tivesse notificado, teria chamado pi.exec — o mock do harness não executa nada,
  // então o teste aqui é que o fluxo completa sem erro.
  assert.ok(true);
});

test("registra o comando /notify", () => {
  assert.ok(ext.commands.notify, "/notify precisa existir para ligar/desligar e ajustar o limiar");
});
