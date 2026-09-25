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

test("--global remove o tema termux-neon antigo e preserva outros temas e settings", () => {
  const home = mkdtempSync(join(tmpdir(), "pi-global-theme-"));
  const agent = join(home, ".pi", "agent");
  const themes = join(agent, "themes");
  mkdirSync(themes, { recursive: true });
  writeFileSync(join(themes, "termux-neon.json"), "{}\n");
  writeFileSync(join(themes, "termux-neon.md"), "# tema\n");
  writeFileSync(join(themes, "meu-tema.json"), "{}\n");
  writeFileSync(join(agent, "settings.json"), JSON.stringify({ defaultModel: "x", theme: "termux-neon", packages: ["a"] }, null, 2));

  runInstall(["--global", repoRoot], { home });

  assert.equal(existsSync(join(themes, "termux-neon.json")), false);
  assert.equal(existsSync(join(themes, "termux-neon.md")), false);
  assert.ok(existsSync(join(themes, "meu-tema.json")));
  assert.deepEqual(JSON.parse(readFileSync(join(agent, "settings.json"), "utf8")), { defaultModel: "x", packages: ["a"] });
  assert.equal(readdirSync(agent).some((name) => name.includes(".tmp.")), false);
});

test("--global não toca settings.json com outro tema", () => {
  const home = mkdtempSync(join(tmpdir(), "pi-global-theme-other-"));
  const agent = join(home, ".pi", "agent");
  mkdirSync(agent, { recursive: true });
  const settings = '{"theme":"light"}';
  writeFileSync(join(agent, "settings.json"), settings);

  runInstall(["--global", repoRoot], { home });

  assert.equal(readFileSync(join(agent, "settings.json"), "utf8"), settings);
});

test("--global remove a pasta themes quando só tinha o termux-neon", () => {
  const home = mkdtempSync(join(tmpdir(), "pi-global-theme-empty-"));
  const themes = join(home, ".pi", "agent", "themes");
  mkdirSync(themes, { recursive: true });
  writeFileSync(join(themes, "termux-neon.json"), "{}\n");

  runInstall(["--global", repoRoot], { home });

  assert.equal(existsSync(themes), false);
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

test("--project guarda o AGENTS.md próprio do projeto em AGENTS.md.bak", () => {
  const project = mkdtempSync(join(tmpdir(), "pi-project-agents-bak-"));
  writeFileSync(join(project, "AGENTS.md"), "# regras do projeto\n");

  runInstall(["--project", repoRoot], { cwd: project });

  assert.equal(readFileSync(join(project, "AGENTS.md.bak"), "utf8"), "# regras do projeto\n");
  assert.equal(readFileSync(join(project, "AGENTS.md"), "utf8"), readFileSync(join(repoRoot, "AGENTS.md"), "utf8"));
});

test("--project não cria backup quando o AGENTS.md já é igual à origem", () => {
  const project = mkdtempSync(join(tmpdir(), "pi-project-agents-same-"));
  writeFileSync(join(project, "AGENTS.md"), readFileSync(join(repoRoot, "AGENTS.md"), "utf8"));

  runInstall(["--project", repoRoot], { cwd: project });

  assert.equal(existsSync(join(project, "AGENTS.md.bak")), false);
});

test("--project não sobrescreve um AGENTS.md.bak existente", () => {
  const project = mkdtempSync(join(tmpdir(), "pi-project-agents-bak2-"));
  writeFileSync(join(project, "AGENTS.md"), "# versão nova do projeto\n");
  writeFileSync(join(project, "AGENTS.md.bak"), "# backup antigo\n");

  runInstall(["--project", repoRoot], { cwd: project });

  assert.equal(readFileSync(join(project, "AGENTS.md.bak"), "utf8"), "# backup antigo\n");
  const extra = readdirSync(project).filter((name) => /^AGENTS\.md\.bak\.\d+$/.test(name));
  assert.equal(extra.length, 1);
  assert.equal(readFileSync(join(project, extra[0]), "utf8"), "# versão nova do projeto\n");
});
