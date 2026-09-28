import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { importExtension, makeCtx } from "./harness.mjs";

const { JobManager, agentArgs, OUTPUT_LIMIT } = await importExtension("background/manager.ts");
const { default: extension } = await importExtension("background/index.ts");
const command = (code, overrides = {}) => ({ command: process.execPath, args: ["-e", code], cwd: tmpdir(), kind: "command", timeoutMs: 5000, ...overrides });
function fixture() {
  const events = {}, tools = {}, commands = {}, messages = [];
  extension({ on: (name, fn) => { events[name] = fn; }, registerTool: (tool) => { tools[tool.name] = tool; }, registerCommand: (name, spec) => { commands[name] = spec.handler; }, sendMessage: (...args) => { messages.push(args); } });
  return { events, tools, commands, messages };
}
const text = (r) => JSON.parse(r.content[0].text);
async function until(check) {
  for (let i = 0; i < 200; i++) { if (check()) return; await delay(25); }
  assert.fail("Condição não observada em 5 segundos");
}

test("retorna imediatamente, duas tarefas reais rodam juntas, limite é aplicado", async () => {
  const completed = [];
  const jobs = new JobManager((job) => completed.push(job.id));
  try {
    const a = jobs.start(command("setTimeout(() => console.log('A'), 500)"));
    const b = jobs.start(command("setTimeout(() => console.log('B'), 500)"));
    assert.equal(a.state, "running");
    assert.equal(b.state, "running");
    assert.equal(completed.length, 0);
    assert.throws(() => jobs.start(command("")), /duas tarefas/);
    await Promise.all([jobs.wait(a.id), jobs.wait(b.id)]);
    assert.equal(a.state, "completed");
    assert.equal(b.state, "completed");
    assert.match(a.output, /A/);
    assert.match(b.output, /B/);
    assert.ok(b.startedAt < a.endedAt);
    assert.equal(completed.length, 2);
  } finally { await jobs.dispose(); }
});

test("falha de comando, spawn inválido e saída limitada", async () => {
  const jobs = new JobManager();
  try {
    const bad = jobs.start(command("console.error('erro real'); process.exit(7)"));
    await jobs.wait(bad.id);
    assert.equal(bad.state, "failed"); assert.equal(bad.exitCode, 7); assert.match(bad.output, /erro real/);
    const missing = jobs.start(command("", { command: "/nonexistent/pi-background-test" }));
    await jobs.wait(missing.id);
    assert.equal(missing.state, "failed"); assert.match(missing.error, /ENOENT/);
    const big = jobs.start(command("process.stdout.write('x'.repeat(200000))"));
    await jobs.wait(big.id);
    assert.equal(big.truncated, true); assert.equal(Buffer.byteLength(big.output), OUTPUT_LIMIT);
    const unicode = jobs.start(command("process.stdout.write('😀'.repeat(50000)+'x')"));
    await jobs.wait(unicode.id);
    assert.ok(Buffer.byteLength(unicode.output) <= OUTPUT_LIMIT);
    assert.throws(() => jobs.get("missing"), /inexistente/);
  } finally { await jobs.dispose(); }
});

test("cancelamento mata descendente resistente e timeout é distinto", async () => {
  const dir = mkdtempSync(join(tmpdir(), "background-test-"));
  const jobs = new JobManager();
  try {
    const pidFile = join(dir, "pid");
    const code = `const {spawn}=require('node:child_process'); const c=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'}); require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(c.pid)); process.on('SIGTERM',()=>{});setInterval(()=>{},1000);`;
    const job = jobs.start(command(code));
    await until(() => { try { return !!readFileSync(pidFile, "utf8"); } catch { return false; } });
    const pid = Number(readFileSync(pidFile, "utf8"));
    jobs.stop(job.id);
    await jobs.wait(job.id);
    assert.equal(job.state, "cancelled");
    // No Android, filho morto pode ficar zombie até o init recolher: não está executando.
    await until(() => {
      try { process.kill(pid, 0); } catch (e) { return e.code === "ESRCH"; }
      try { return /\) Z /.test(readFileSync(`/proc/${pid}/stat`, "utf8")); } catch { return false; }
    });
    const timed = jobs.start(command("setInterval(()=>{},1000)", { timeoutMs: 100 }));
    await jobs.wait(timed.id); assert.equal(timed.state, "timed_out");
  } finally { await jobs.dispose(); rmSync(dir, { recursive: true, force: true }); }
});

test("JSON de subagente, uso, Unicode e erro com exit zero", async () => {
  const jobs = new JobManager();
  try {
    const message = { type: "message_end", message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "olá\u2028mundo" }], usage: { input: 10, output: 2, totalTokens: 12, cost: { total: 0.1 } } } };
    const job = jobs.start(command(`process.stdout.write(${JSON.stringify(JSON.stringify(message) + "\n")})`, { kind: "agent" }));
    await jobs.wait(job.id);
    assert.equal(job.state, "completed"); assert.match(job.output, /olá\u2028mundo/); assert.equal(job.usage.totalTokens, 12);
    message.message.stopReason = "error";
    const failed = jobs.start(command(`console.log(${JSON.stringify(JSON.stringify(message))})`, { kind: "agent" }));
    await jobs.wait(failed.id); assert.equal(failed.state, "failed");
    const overflow = jobs.start(command("process.stdout.write('x'.repeat(1100000));setInterval(()=>{},1000)", { kind: "agent" }));
    await jobs.wait(overflow.id); assert.equal(overflow.state, "failed"); assert.match(overflow.error, /1 MiB/);
  } finally { await jobs.dispose(); }
});

test("argumentos de subagente: sem recursão, leitura padrão e sessão de escrita", () => {
  const args = agentArgs("-tarefa", "provider/model");
  assert.ok(args.includes("-ne")); assert.ok(args.includes("-na")); assert.ok(args.includes("--no-session"));
  assert.equal(args[args.indexOf("--tools") + 1], "read,grep,find,ls");
  assert.equal(args[args.indexOf("--model") + 1], "provider/model");
  assert.ok(args.indexOf("--") < args.length - 1);
  const write = agentArgs("tarefa", undefined, "/tmp/private/session.jsonl");
  assert.ok(!write.includes("--no-session")); assert.ok(write.includes("read,grep,find,ls,write,edit,bash"));
});

test("extensão: ferramentas não bloqueantes, aviso sem turno e sem logs brutos", async () => {
  const f = fixture(); const ctx = makeCtx();
  await f.events.session_start({}, ctx);
  try {
    const start = await f.tools.background_start.execute("1", { command: "sleep 0.2; printf PRIVATE_OUTPUT", task: "  " }, undefined, undefined, ctx);
    const job = text(start);
    assert.equal(job.state, "running");
    await until(() => f.messages.length > 0);
    assert.equal(f.messages[0][1].triggerTurn, false);
    assert.ok(!f.messages[0][0].content.includes("PRIVATE_OUTPUT"));
    const status = text(await f.tools.background_jobs.execute("2", { id: job.id }));
    assert.equal(status.state, "completed"); assert.equal(status.output, "PRIVATE_OUTPUT");
    await f.commands.jobs(job.id, ctx); assert.match(f.messages[1][0].content, /PRIVATE_OUTPUT/);
    await assert.rejects(f.tools.background_start.execute("3", { command: "true", task: "x" }, undefined, undefined, ctx), /exatamente um/);
    await assert.rejects(f.tools.background_start.execute("4", { task: "x", allowWrite: true }, undefined, undefined, makeCtx({ hasUI: false })), /confirmação/);
    await assert.rejects(f.tools.background_start.execute("5", { task: "x", allowWrite: true }, undefined, undefined, makeCtx({ ui: { confirm: async () => false } })), /não autorizada/);
  } finally { await f.events.session_shutdown({ reason: "quit" }); }
});

test("usage de agente é entregue uma vez; escrita guarda sessão privada", async () => {
  const dir = mkdtempSync(join(tmpdir(), "background-fake-pi-"));
  const oldPath = process.env.PATH;
  const fakePi = join(dir, "pi");
  const message = { type: "message_end", message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "resultado" }], usage: { input: 8, output: 2, totalTokens: 10 } } };
  writeFileSync(fakePi, `#!/bin/sh\nprintf '%s\\n' '${JSON.stringify(message)}'\n`);
  chmodSync(fakePi, 0o700);
  process.env.PATH = `${dir}:${oldPath}`;
  const f = fixture(); const ctx = makeCtx();
  let sessionFile;
  await f.events.session_start({}, ctx);
  try {
    const job = text(await f.tools.background_start.execute("1", { task: "teste", allowWrite: true }, undefined, undefined, ctx));
    sessionFile = job.sessionFile;
    assert.match(sessionFile, /pi-background-session-/);
    assert.equal(statSync(join(sessionFile, "..")).mode & 0o777, 0o700);
    await until(() => f.messages.length > 0);
    const first = await f.tools.background_jobs.execute("2", { id: job.id });
    assert.equal(first.usage.totalTokens, 10);
    const second = await f.tools.background_jobs.execute("3", { id: job.id });
    assert.equal(second.usage, undefined);
  } finally {
    await f.events.session_shutdown({ reason: "quit" });
    process.env.PATH = oldPath;
    rmSync(dir, { recursive: true, force: true });
    if (sessionFile) rmSync(join(sessionFile, ".."), { recursive: true, force: true });
  }
});

test("troca de sessão durante confirmação impede início tardio", async () => {
  const f = fixture(); let approve;
  const ctx = makeCtx({ ui: { confirm: () => new Promise(resolve => { approve = resolve; }) } });
  await f.events.session_start({}, ctx);
  const pending = f.tools.background_start.execute("1", { task: "teste", allowWrite: true }, undefined, undefined, ctx);
  await f.events.session_shutdown({ reason: "new" });
  approve(true);
  await assert.rejects(pending, /sessão substituída/);
});

for (const reason of ["quit", "reload", "new", "resume", "fork"]) {
  test(`lifecycle ${reason}: encerra tarefa e suprime avisos tardios`, async () => {
    const f = fixture(); const ctx = makeCtx();
    await f.events.session_start({}, ctx);
    const job = text(await f.tools.background_start.execute("1", { command: "sleep 30" }, undefined, undefined, ctx));
    assert.equal(job.state, "running");
    await f.events.session_shutdown({ reason });
    assert.equal(f.messages.length, 0);
    await assert.rejects(f.tools.background_jobs.execute("2", {}), /indisponível/);
    await f.events.session_start({}, ctx);
    assert.deepEqual(text(await f.tools.background_jobs.execute("3", {})), []);
    await f.events.session_shutdown({ reason: "quit" });
  });
}
