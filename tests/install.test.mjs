import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { repoRoot } from "./harness.mjs";

function runInstall(args, { cwd, home } = {}) {
  return execFileSync("bash", [join(repoRoot, "install-pi-config.sh"), ...args], {
    cwd: cwd ?? repoRoot,
    env: { ...process.env, HOME: home ?? process.env.HOME },
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
