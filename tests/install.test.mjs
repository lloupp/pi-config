import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { repoRoot } from "./harness.mjs";

function runInstall(args, { cwd, home, env } = {}) {
  return execFileSync("bash", [join(repoRoot, "install-pi-config.sh"), ...args], {
    cwd: cwd ?? repoRoot,
    env: { ...process.env, ...env, HOME: home ?? process.env.HOME },
    encoding: "utf8",
  });
}

test("--project instala no layout descoberto pelo Pi", () => {
  const project = mkdtempSync(join(tmpdir(), "pi-project-install-"));

  runInstall(["--project", repoRoot], { cwd: project });

  assert.equal(readFileSync(join(project, "AGENTS.md"), "utf8"), readFileSync(join(repoRoot, "AGENTS.md"), "utf8"));
  assert.ok(existsSync(join(project, ".pi", "extensions", "web-tools.ts")));
  assert.ok(existsSync(join(project, ".pi", "skills", "verify", "SKILL.md")));
  assert.ok(existsSync(join(project, ".pi", "prompts", "debug.md")));
  assert.equal(existsSync(join(project, ".pi", "agent")), false, "recursos de projeto não pertencem a .pi/agent");
});

test("--project espelha diretórios e remove recurso obsoleto", () => {
  const project = mkdtempSync(join(tmpdir(), "pi-project-mirror-"));
  const staleDir = join(project, ".pi", "extensions");
  mkdirSync(staleDir, { recursive: true });
  writeFileSync(join(staleDir, "obsoleta.ts"), "export default 1;\n");

  runInstall(["--project", repoRoot], { cwd: project });

  assert.equal(existsSync(join(staleDir, "obsoleta.ts")), false);
  assert.ok(existsSync(join(staleDir, "checkpoint.ts")));
});

test("falha de cópia não apaga o diretório já instalado", () => {
  const project = mkdtempSync(join(tmpdir(), "pi-project-atomic-"));
  const source = mkdtempSync(join(tmpdir(), "pi-source-atomic-"));
  const fakeBin = mkdtempSync(join(tmpdir(), "pi-fake-bin-"));
  const dest = join(project, ".pi", "extensions");

  mkdirSync(join(source, "extensions"), { recursive: true });
  writeFileSync(join(source, "extensions", "nova.ts"), "export default 'nova';\n");
  mkdirSync(dest, { recursive: true });
  writeFileSync(join(dest, "estavel.ts"), "export default 'estavel';\n");

  const fakeCp = join(fakeBin, "cp");
  writeFileSync(fakeCp, "#!/bin/sh\nexit 77\n");
  chmodSync(fakeCp, 0o755);

  assert.throws(
    () => runInstall(["--project", source], { cwd: project, env: { PATH: `${fakeBin}:${process.env.PATH}` } }),
    /Command failed|status 1|status 77/i,
  );

  assert.equal(readFileSync(join(dest, "estavel.ts"), "utf8"), "export default 'estavel';\n");
  assert.equal(existsSync(join(dest, "nova.ts")), false);
  assert.equal(readdirSync(join(project, ".pi")).some((name) => name.startsWith(".extensions.stage.")), false);
});

test("--global preserva o layout ~/.pi/agent", () => {
  const home = mkdtempSync(join(tmpdir(), "pi-global-install-"));

  runInstall(["--global", repoRoot], { home });

  const agent = join(home, ".pi", "agent");
  assert.ok(existsSync(join(agent, "AGENTS.md")));
  assert.ok(existsSync(join(agent, "extensions", "web-tools.ts")));
  assert.ok(existsSync(join(agent, "skills", "verify", "SKILL.md")));
  assert.ok(existsSync(join(agent, "prompts", "debug.md")));
});

test("--global com origem igual a ~/.pi/agent é idempotente e não apaga dados", () => {
  const home = mkdtempSync(join(tmpdir(), "pi-global-self-"));
  const agent = join(home, ".pi", "agent");
  mkdirSync(join(agent, "extensions"), { recursive: true });
  mkdirSync(join(agent, "skills"), { recursive: true });
  mkdirSync(join(agent, "prompts"), { recursive: true });
  writeFileSync(join(agent, "AGENTS.md"), "# regras locais\n");
  writeFileSync(join(agent, "extensions", "x.ts"), "export default 1;\n");
  writeFileSync(join(agent, "skills", "x.md"), "skill\n");
  writeFileSync(join(agent, "prompts", "x.md"), "prompt\n");

  runInstall(["--global", agent], { home });

  assert.equal(readFileSync(join(agent, "AGENTS.md"), "utf8"), "# regras locais\n");
  assert.ok(existsSync(join(agent, "extensions", "x.ts")));
  assert.ok(existsSync(join(agent, "skills", "x.md")));
  assert.ok(existsSync(join(agent, "prompts", "x.md")));
});
