import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { test } from "node:test";
import { importExtension, loadExtension, makeCtx } from "./harness.mjs";

const {
  LightpandaReplSession,
  buildAgentArgs,
  buildLightpandaArgs,
  buildLightpandaInvocation,
  buildTermuxWrapper,
  isTermuxEnvironment,
  replCommand,
  resolveLightpandaLaunch,
  validateBrowserUrl,
} = await importExtension("lightpanda.ts");

const ok = (stdout = "") => ({ code: 0, stdout, stderr: "", killed: false });

function makeFakeSpawn({ clickError = false } = {}) {
  const calls = [];
  const commands = [];

  const spawn = (command, args, options) => {
    calls.push({ command, args, options });
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const proc = new EventEmitter();
    proc.stdout = stdout;
    proc.stderr = stderr;
    proc.killed = false;
    proc.exitCode = null;
    proc.kill = (signal = "SIGTERM") => {
      proc.killed = true;
      proc.exitCode = 0;
      proc.emit("exit", 0, signal);
      return true;
    };

    let buffer = "";
    const marker = options.env.LP_PI_MARKER;
    proc.stdin = new Writable({
      write(chunk, _encoding, callback) {
        buffer += chunk.toString();
        let newline;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line) continue;
          commands.push(line);

          if (line.startsWith("/click") && clickError) stderr.write("Error: click failed: NodeNotFound\n");
          if (line === "/markdown") stdout.write("# Página atual\n\nConteúdo renderizado.\n");
          if (line === "/getEnv LP_PI_MARKER") stdout.write(`${marker}\n`);
        }
        callback();
      },
    });
    return proc;
  };

  return { spawn, calls, commands };
}

test("runtime Linux continua direto e Termux escolhe proot-distro Debian", () => {
  const linux = resolveLightpandaLaunch({}, "linux");
  assert.equal(linux.mode, "direct");
  assert.equal(linux.command, "lightpanda");
  assert.deepEqual(buildLightpandaInvocation(linux, ["version"]), {
    command: "lightpanda",
    args: ["version"],
  });

  const termuxEnv = {
    PREFIX: "/data/data/com.termux/files/usr",
    HOME: "/data/data/com.termux/files/home",
    TERMUX_VERSION: "0.119",
  };
  assert.equal(isTermuxEnvironment(termuxEnv, "linux"), true);
  const termux = resolveLightpandaLaunch(termuxEnv, "linux");
  assert.equal(termux.mode, "termux-proot");
  assert.equal(termux.distro, "debian");
  assert.deepEqual(buildLightpandaInvocation(termux, ["version"]), {
    command: "proot-distro",
    args: ["login", "--shared-tmp", "debian", "--", "lightpanda", "version"],
  });
});

test("LIGHTPANDA_BIN tem precedência mesmo dentro do Termux", () => {
  const launch = resolveLightpandaLaunch(
    {
      TERMUX_VERSION: "0.119",
      PREFIX: "/data/data/com.termux/files/usr",
      LIGHTPANDA_BIN: "/data/local/bin/lightpanda-wrapper",
    },
    "android",
  );
  assert.equal(launch.mode, "direct");
  assert.equal(launch.command, "/data/local/bin/lightpanda-wrapper");
});

test("wrapper do proot encaminha apenas env permitido e mantém segredo fora de argv", async () => {
  const env = {
    TERMUX_VERSION: "0.119",
    PREFIX: "/data/data/com.termux/files/usr",
    LP_PASSWORD: "segredo muito secreto",
    OTHER_SECRET: "nao-deve-passar",
    HTTPS_PROXY: "http://proxy.example:8080",
  };
  const wrapper = buildTermuxWrapper("marker-test", "/usr/local/bin/lightpanda", env);
  assert.match(wrapper, /LP_PI_MARKER/);
  assert.match(wrapper, /LP_PASSWORD/);
  assert.match(wrapper, /HTTPS_PROXY/);
  assert.doesNotMatch(wrapper, /OTHER_SECRET/);
  assert.match(wrapper, /exec '\/usr\/local\/bin\/lightpanda' "\$@"/);

  const launch = resolveLightpandaLaunch(env, "android");
  const fake = makeFakeSpawn();
  const session = new LightpandaReplSession(launch, fake.spawn, env);
  const result = await session.execute(
    { name: "goto", args: { url: "https://example.com" } },
    { markdown: true },
  );

  assert.match(result, /Página atual/);
  assert.equal(fake.calls[0].command, "proot-distro");
  assert.deepEqual(fake.calls[0].args.slice(0, 4), ["login", "--shared-tmp", "debian", "--"]);
  assert.equal(fake.calls[0].args[4], "bash");
  assert.match(fake.calls[0].args[5], /^\/tmp\/pi-lightpanda-/);
  assert.ok(fake.calls[0].args.includes("agent"));
  assert.doesNotMatch(fake.calls[0].args.join(" "), /segredo muito secreto/);
  session.close(true);
});

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
  assert.equal(result.details.runtime, "direct");
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

test("URL com credenciais é rejeitada para não vazar segredo", () => {
  assert.throws(() => validateBrowserUrl("https://user:secret@example.com/"), /credenciais|usuário\/senha/i);
});

test("args stateless sempre carregam limites e bloqueio de rede privada", () => {
  const args = buildLightpandaArgs({ url: "https://example.com/", waitMs: 99999, maxChars: 999999 });
  const valueAfter = (flag) => args[args.indexOf(flag) + 1];

  assert.ok(args.includes("--block-private-networks"));
  assert.equal(valueAfter("--wait-ms"), "8000");
  assert.equal(valueAfter("--http-max-response-size"), "5000000");
  assert.equal(valueAfter("--terminate-ms"), "18000");
  assert.equal(valueAfter("--watchdog-ms"), "10000");
  assert.ok(Number(valueAfter("--dump-max-bytes")) <= 121024);
});

test("sessão interativa inicia sem LLM e bloqueia redes privadas", () => {
  const args = buildAgentArgs();
  assert.deepEqual(args.slice(0, 2), ["agent", "--no-llm"]);
  assert.ok(args.includes("--block-private-networks"));
  assert.ok(args.includes("--verbosity"));
  assert.ok(args.includes("--log-level"));
});

test("slash command usa JSON em stdin, sem shell e sem interpolação textual", () => {
  const line = replCommand({ name: "fill", args: { selector: "input[name='q']", value: "a b; $(echo nope)\nlinha2" } });
  assert.ok(line.startsWith('/fill {"selector":'));
  assert.match(line, /\\nlinha2/);
  assert.match(line, /\$\(echo nope\)/);
  assert.throws(() => replCommand({ name: "click;rm", args: {} }), /inválido/i);
});

test("um único processo mantém página/cookies entre goto, click e fill", async () => {
  const fake = makeFakeSpawn();
  const session = new LightpandaReplSession("lightpanda", fake.spawn);

  const first = await session.execute({ name: "goto", args: { url: "https://example.com/login" } }, { markdown: true });
  const second = await session.execute({ name: "fill", args: { selector: "#email", value: "$LP_EMAIL" } }, { markdown: true });
  const third = await session.execute(
    [
      { name: "click", args: { selector: "button[type='submit']" } },
      { name: "waitForSelector", args: { selector: "#dashboard", timeout: 8000 } },
    ],
    { markdown: true },
  );

  assert.equal(fake.calls.length, 1, "a sessão inteira deve compartilhar um processo Lightpanda");
  assert.equal(fake.calls[0].command, "lightpanda");
  assert.match(first, /Página atual/);
  assert.match(second, /Página atual/);
  assert.match(third, /Página atual/);
  assert.ok(fake.commands.some((line) => line.includes('"value":"$LP_EMAIL"')));
  assert.ok(fake.commands.some((line) => line.startsWith("/waitForSelector")));
  assert.equal(fake.commands.filter((line) => line === "/getEnv LP_PI_MARKER").length, 3);

  session.close(true);
});

test("erro de interação é reportado e não mascarado pelo markdown posterior", async () => {
  const fake = makeFakeSpawn({ clickError: true });
  const session = new LightpandaReplSession("lightpanda", fake.spawn);

  await assert.rejects(
    session.execute({ name: "click", args: { selector: "#inexistente" } }, { markdown: true }),
    /NodeNotFound|click failed/i,
  );
  session.close(true);
});

test("extensão registra ferramentas interativas e exige browser_start antes de agir", async () => {
  const ext = await loadExtension("lightpanda.ts", { exec: async () => ok("lightpanda test\n") });
  for (const tool of ["browser_start", "browser_click", "browser_fill", "browser_close"]) assert.ok(ext.tools[tool], tool);
  assert.equal(typeof ext.events.session_shutdown, "function");

  await assert.rejects(
    ext.tools.browser_click.execute("call-x", { selector: "button" }, new AbortController().signal),
    /browser_start/i,
  );
});

test("binário ausente produz erro de instalação acionável no modo stateless", async () => {
  const ext = await loadExtension("lightpanda.ts", {
    exec: async () => ({ code: 127, stdout: "", stderr: "lightpanda: not found", killed: false }),
  });

  await assert.rejects(
    ext.tools.browser_open.execute("call-3", { url: "https://example.com/" }, new AbortController().signal),
    /LIGHTPANDA_BIN|PATH/i,
  );
});

test("/lightpanda mostra a versão e o runtime quando o binário está disponível", async () => {
  const avisos = [];
  const ext = await loadExtension("lightpanda.ts", { exec: async () => ok("lightpanda 0.0-test\n") });
  await ext.commands.lightpanda("", makeCtx({ ui: { notify: (msg) => avisos.push(msg) } }));
  assert.match(avisos.join("\n"), /0\.0-test/);
  assert.match(avisos.join("\n"), /Runtime:/);
});
