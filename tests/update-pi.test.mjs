import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadExtension, makeCtx } from "./harness.mjs";

const ok = (stdout = "") => ({ code: 0, stdout, stderr: "", killed: false });

test("/sync-pi espelha diretório e não ressuscita arquivo removido", async () => {
  const oldHome = process.env.HOME;
  const home = mkdtempSync(join(tmpdir(), "pi-sync-home-"));
  const repo = mkdtempSync(join(tmpdir(), "pi-sync-repo-"));
  process.env.HOME = home;
  try {
    const source = join(home, ".pi", "agent", "extensions");
    const dest = join(repo, "extensions");
    mkdirSync(source, { recursive: true });
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(source, "nova.ts"), "export default 'nova';\n");
    writeFileSync(join(dest, "nova.ts"), "export default 'velha';\n");
    writeFileSync(join(dest, "obsoleta.ts"), "export default 'stale';\n");

    let statusCalls = 0;
    const calls = [];
    const exec = async (command, args) => {
      calls.push([command, ...args]);
      if (command === "git" && args[2] === "status") {
        statusCalls++;
        return statusCalls === 1 ? ok("") : ok(" M extensions/nova.ts\n D extensions/obsoleta.ts\n");
      }
      return ok();
    };

    const ext = await loadExtension("update-pi.ts", { exec });
    await ext.commands["sync-pi"](repo, makeCtx({ ui: { notify: () => {} } }));

    assert.equal(readFileSync(join(dest, "nova.ts"), "utf8"), "export default 'nova';\n");
    assert.equal(existsSync(join(dest, "obsoleta.ts")), false);
    assert.ok(calls.some((call) => call[0] === "git" && call.at(-1) === "push"));
  } finally {
    process.env.HOME = oldHome;
  }
});

test("/update-pi não instala quando a suíte falha", async () => {
  const repo = "/tmp/pi-config-update-fail";
  const calls = [];
  let revParseCalls = 0;
  let reloads = 0;
  const avisos = [];

  const exec = async (command, args) => {
    calls.push([command, ...args]);
    if (command === "git" && args[2] === "status") return ok("");
    if (command === "git" && args[2] === "rev-parse") return ok(++revParseCalls === 1 ? "aaa\n" : "bbb\n");
    if (command === "git" && args[2] === "pull") return ok("updated\n");
    if (command === "git" && args[2] === "log") return ok("bbb corrige algo\n");
    if (command === "bash" && args[0].endsWith("run-tests.sh")) {
      return { code: 1, stdout: "", stderr: "teste vermelho", killed: false };
    }
    if (command === "bash" && args[0].endsWith("install-pi-config.sh")) {
      throw new Error("instalador não deveria ser chamado");
    }
    return ok();
  };

  const ext = await loadExtension("update-pi.ts", { exec });
  const ctx = makeCtx({
    ui: { notify: (msg) => avisos.push(msg), confirm: async () => true },
    reload: async () => { reloads++; },
  });
  await ext.commands["update-pi"](repo, ctx);

  assert.equal(reloads, 0);
  assert.match(avisos.join("\n"), /NÃO instalada|suíte falhou/i);
  assert.equal(calls.filter((call) => call[0] === "bash").length, 1, "só a suíte deve executar");
});

test("/update-pi instala e recarrega somente depois da suíte verde", async () => {
  const repo = "/tmp/pi-config-update-pass";
  const calls = [];
  let revParseCalls = 0;
  let reloads = 0;

  const exec = async (command, args) => {
    calls.push([command, ...args]);
    if (command === "git" && args[2] === "status") return ok("");
    if (command === "git" && args[2] === "rev-parse") return ok(++revParseCalls === 1 ? "aaa\n" : "bbb\n");
    if (command === "git" && args[2] === "pull") return ok("updated\n");
    if (command === "git" && args[2] === "log") return ok("bbb corrige algo\n");
    if (command === "bash" && args[0].endsWith("run-tests.sh")) return ok("todos verdes\n");
    if (command === "bash" && args[0].endsWith("install-pi-config.sh")) return ok("instalado\n");
    return ok();
  };

  const ext = await loadExtension("update-pi.ts", { exec });
  const ctx = makeCtx({
    ui: { notify: () => {}, confirm: async () => true },
    reload: async () => { reloads++; },
  });
  await ext.commands["update-pi"](repo, ctx);

  const bashCalls = calls.filter((call) => call[0] === "bash");
  assert.match(bashCalls[0][1], /run-tests\.sh$/);
  assert.match(bashCalls[1][1], /install-pi-config\.sh$/);
  assert.equal(reloads, 1);
});
