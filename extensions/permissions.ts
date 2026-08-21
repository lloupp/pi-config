// Sistema de permissões no modelo do Claude Code: modos ciclados por Shift+Tab e regras
// allow/ask/deny no settings.json.
//
// A API do pi não tem permissões — só o evento `tool_call`, que um handler pode responder
// com { block, reason }. Esta extensão é essa camada, e absorve o que o safety-guard fazia
// caso a caso, ganhando o que faltava: modos, regras persistidas e "sempre permitir".
//
// Comunicação com outras extensões é pelo pi.events, e não por um módulo compartilhado: o
// loader cria um jiti por extensão com moduleCache:false, então um import comum viraria
// duas instâncias, não um singleton.
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type PermissionMode = "perguntar" | "aceitar-edicoes" | "plano" | "sem-confirmacao";

// sem-confirmacao fica FORA do ciclo, como o bypassPermissions do Claude Code: só se entra
// nele deliberadamente por /permissions, com confirmação.
export const modeCycle: PermissionMode[] = ["perguntar", "aceitar-edicoes", "plano"];

const modeLabel: Record<PermissionMode, string> = {
  perguntar: "perguntar",
  "aceitar-edicoes": "aceitar edições",
  plano: "plano",
  "sem-confirmacao": "SEM CONFIRMAÇÃO",
};

const dialogTimeoutMs = 300_000;

/** Canais do pi.events, usados por plan-tasks e por quem mais precise reagir ao modo. */
export const MODE_CHANGED = "permissions:mode";
export const SET_MODE = "permissions:set-mode";

// --- regras -----------------------------------------------------------------

export type Decision = "allow" | "ask" | "deny";

export interface Rule {
  /** Nome da ferramenta em minúsculas, ou "*" para qualquer uma. */
  tool: string;
  /** Padrão do alvo; ausente significa "qualquer alvo desta ferramenta". */
  matcher?: string;
  raw: string;
}

/** Aceita `Bash(git push:*)`, `Edit(src/**)`, `Read(.env)` ou `Bash` puro. */
export function parseRule(raw: string): Rule | undefined {
  const trimmed = String(raw ?? "").trim();
  const match = /^([A-Za-z_*][\w*]*)(?:\(([\s\S]*)\))?$/.exec(trimmed);
  if (!match) return undefined;
  const matcher = match[2]?.trim();
  return { tool: match[1].toLowerCase(), matcher: matcher || undefined, raw: trimmed };
}

/** Glob no estilo do Claude Code: ** atravessa diretórios, * fica dentro de um segmento. */
export function globToRegExp(glob: string): RegExp {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    if (char === "*") {
      if (glob[i + 1] === "*") {
        out += ".*";
        i++;
        if (glob[i + 1] === "/") i++;
      } else {
        out += "[^/]*";
      }
    } else if (char === "?") {
      out += "[^/]";
    } else {
      out += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${out}$`);
}

export function ruleMatches(rule: Rule, toolName: string, target: string): boolean {
  if (rule.tool !== "*" && rule.tool !== toolName.toLowerCase()) return false;
  if (!rule.matcher) return true;

  // `git push:*` = prefixo do comando, a forma que o Claude Code usa para bash.
  if (rule.matcher.endsWith(":*")) {
    const prefix = rule.matcher.slice(0, -2).trim();
    const value = target.trim();
    return value === prefix || value.startsWith(`${prefix} `);
  }
  return globToRegExp(rule.matcher).test(target);
}

function firstMatch(raws: string[], toolName: string, target: string): Rule | undefined {
  for (const raw of raws) {
    const rule = parseRule(raw);
    if (rule && ruleMatches(rule, toolName, target)) return rule;
  }
  return undefined;
}

// --- regras embutidas (herdadas do safety-guard) -----------------------------

const destructiveBash: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\brm\s+(?:-[^\n;|&]*[rf][^\n;|&]*|--recursive|--force)/i, label: "remoção recursiva/forçada" },
  { pattern: /\bgit\s+reset\s+--hard\b/i, label: "git reset --hard" },
  { pattern: /\bgit\s+clean\s+-[^\n;|&]*[fd][^\n;|&]*/i, label: "git clean destrutivo" },
  { pattern: /\b(pkg|apt)\s+(?:remove|purge|uninstall|autoremove)\b/i, label: "remoção de pacotes" },
  { pattern: /\bchmod\s+-R\b/i, label: "chmod recursivo" },
  { pattern: /\bchown\s+-R\b/i, label: "chown recursivo" },
  { pattern: /\bcurl\b[^\n|;]*\|\s*(?:sh|bash)\b/i, label: "curl pipe shell" },
  { pattern: /\bwget\b[^\n|;]*\|\s*(?:sh|bash)\b/i, label: "wget pipe shell" },
  { pattern: /\bgit\s+push\b[^\n;|&]*(?:--force(?:-with-lease)?\b|\s-f\b)/i, label: "push forçado (reescreve histórico remoto)" },
  { pattern: /\bdd\b[^\n;|&]*\bof=\/dev\//i, label: "escrita direta em dispositivo" },
  { pattern: /\bmkfs(\.\w+)?\b/i, label: "formatação de sistema de arquivos" },
];

const secretPaths: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /(^|\/)\.env(?:\.|$)/i, label: "arquivo .env" },
  { pattern: /(^|\/)\.ssh(?:\/|$)/i, label: "chaves SSH" },
  { pattern: /(^|\/)auth\.json$/i, label: "auth.json" },
  { pattern: /(^|\/)credentials\.json$/i, label: "credentials.json" },
  { pattern: /\.pem$/i, label: "certificado/chave .pem" },
  { pattern: /(^|\/)id_(?:rsa|ed25519)(?:\.pub)?$/i, label: "chave privada SSH" },
];

// Infra: protegida só em escrita — ler é legítimo e frequente.
const infraPaths: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /(^|\/)\.git(?:\/|$)/i, label: "diretório .git" },
  { pattern: /(^|\/)node_modules(?:\/|$)/i, label: "node_modules" },
];

/** Tokeniza para reusar os padrões ancorados em caminho dentro de um comando bash. */
function bashTouchesSecret(command: string) {
  const tokens = command.split(/[\s;|&><()"'`=]+/).filter(Boolean);
  return secretPaths.find(({ pattern }) => tokens.some((token) => pattern.test(token)));
}

// --- settings.json -----------------------------------------------------------

export interface PermissionSettings {
  allow: string[];
  ask: string[];
  deny: string[];
  mode?: PermissionMode;
  /** Confirmar todo bash, não só o destrutivo (o padrão do Claude Code; ver README). */
  askForAllBash?: boolean;
}

function agentDir(): string {
  return process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
}

function settingsFile(): string {
  return join(agentDir(), "settings.json");
}

function readSettings(): Record<string, any> {
  try {
    const file = settingsFile();
    if (!existsSync(file)) return {};
    return JSON.parse(readFileSync(file, "utf8")) ?? {};
  } catch {
    // settings.json corrompido não pode derrubar as permissões: segue com o padrão.
    return {};
  }
}

export function loadPermissions(): PermissionSettings {
  const raw = readSettings().permissions ?? {};
  const list = (value: unknown) => (Array.isArray(value) ? value.filter((v) => typeof v === "string") : []);
  return {
    allow: list(raw.allow),
    ask: list(raw.ask),
    deny: list(raw.deny),
    mode: raw.mode,
    askForAllBash: raw.askForAllBash === true,
  };
}

/** Grava uma regra preservando o resto do settings.json (chaves e ordem). */
export function persistRule(list: "allow" | "ask" | "deny", raw: string): void {
  const settings = readSettings();
  const permissions = (settings.permissions ??= {});
  const rules: string[] = (permissions[list] ??= []);
  if (!rules.includes(raw)) rules.push(raw);
  writeFileSync(settingsFile(), `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

function persistMode(mode: PermissionMode): void {
  const settings = readSettings();
  const permissions = (settings.permissions ??= {});
  permissions.mode = mode;
  writeFileSync(settingsFile(), `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

// --- decisão -----------------------------------------------------------------

export interface Judgement {
  decision: Decision;
  reason: string;
  /** Regra que o "sempre permitir" gravaria. */
  suggestion: string;
}

/** Alvo da regra: o comando, para bash; o caminho, para as ferramentas de arquivo. */
export function targetOf(toolName: string, input: any): string {
  if (toolName === "bash") return String(input?.command ?? "");
  if (toolName === "read" || toolName === "write" || toolName === "edit") return String(input?.path ?? "");
  return "";
}

function suggestionFor(toolName: string, target: string): string {
  const label = toolName.charAt(0).toUpperCase() + toolName.slice(1);
  if (toolName !== "bash") return `${label}(${target})`;
  // Sugere o prefixo de dois tokens: `git push:*` em vez do comando inteiro, que
  // nunca voltaria a casar.
  const prefix = target.trim().split(/\s+/).slice(0, 2).join(" ");
  return `Bash(${prefix}:*)`;
}

/**
 * Ordem de precedência, igual à do Claude Code: deny vence ask, que vence allow.
 *
 * As regras embutidas de confirmação ficam DEPOIS do allow do usuário, e não antes: é o
 * que faz o botão "sempre permitir" funcionar justamente nos comandos que mais abrem
 * dialog. Já as de bloqueio (escrita em .git, node_modules e segredos) ficam antes de
 * tudo e não são liberáveis por allow.
 */
export function judge(
  toolName: string,
  input: any,
  mode: PermissionMode,
  settings: PermissionSettings,
): Judgement {
  const target = targetOf(toolName, input);
  const suggestion = suggestionFor(toolName, target);
  const tool = toolName.toLowerCase();

  if (mode === "sem-confirmacao") {
    return { decision: "allow", reason: "modo sem confirmação", suggestion };
  }

  const denied = firstMatch(settings.deny, tool, target);
  if (denied) return { decision: "deny", reason: `regra deny: ${denied.raw}`, suggestion };

  if (tool === "write" || tool === "edit") {
    const blocked = [...secretPaths, ...infraPaths].find(({ pattern }) => pattern.test(target));
    if (blocked) return { decision: "deny", reason: `caminho protegido (${blocked.label})`, suggestion };
  }

  const asked = firstMatch(settings.ask, tool, target);
  if (asked) return { decision: "ask", reason: `regra ask: ${asked.raw}`, suggestion };

  const allowed = firstMatch(settings.allow, tool, target);
  if (allowed) return { decision: "allow", reason: `regra allow: ${allowed.raw}`, suggestion };

  if (tool === "bash") {
    const danger = destructiveBash.find(({ pattern }) => pattern.test(target));
    if (danger) return { decision: "ask", reason: `comando perigoso (${danger.label})`, suggestion };
    const secret = bashTouchesSecret(target);
    if (secret) return { decision: "ask", reason: `acesso a arquivo sensível (${secret.label})`, suggestion };
  }

  if (tool === "read") {
    const secret = secretPaths.find(({ pattern }) => pattern.test(target));
    if (secret) return { decision: "ask", reason: `leitura de arquivo sensível (${secret.label})`, suggestion };
  }

  // Padrão do modo. Em `plano`, escrita é problema do plan-tasks, que conhece o arquivo
  // de plano e libera só ele — por isso aqui ela passa.
  if (mode === "perguntar" && (tool === "write" || tool === "edit")) {
    return { decision: "ask", reason: "modo perguntar: confirmar edições", suggestion };
  }
  if (settings.askForAllBash && tool === "bash" && mode !== "aceitar-edicoes") {
    return { decision: "ask", reason: "askForAllBash", suggestion };
  }

  return { decision: "allow", reason: "sem regra aplicável", suggestion };
}

// --- extensão ----------------------------------------------------------------

export default function (pi: ExtensionAPI) {
  const stored = loadPermissions();
  let mode: PermissionMode = stored.mode ?? "perguntar";
  let settings = stored;
  let lastCtx: ExtensionContext | undefined;

  // Os dialogs são serializados: handlers de tool_call rodam concorrentemente com os tool
  // calls do batch, e dois dialogs simultâneos disputam o slot único da TUI — o primeiro
  // nunca resolve e o turno trava. Ferramentas contornam isso com executionMode:"sequential",
  // que não existe para handlers de evento, então a fila é feita aqui.
  let dialogChain: Promise<unknown> = Promise.resolve();
  function queueDialog<T>(fn: () => Promise<T>): Promise<T> {
    const run = dialogChain.then(fn, fn);
    dialogChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  function showMode(ctx: ExtensionContext | undefined): void {
    if (!ctx?.hasUI) return;
    ctx.ui.setStatus("permissions", `⏵ ${modeLabel[mode]}`);
  }

  function setMode(next: PermissionMode, ctx: ExtensionContext | undefined, persist = true): void {
    if (mode === next) return;
    mode = next;
    if (persist) {
      try {
        persistMode(next);
      } catch {
        // Não poder gravar não pode impedir a troca de modo na sessão corrente.
      }
    }
    showMode(ctx);
    pi.events.emit(MODE_CHANGED, { mode });
  }

  pi.events.on(SET_MODE, (data: any) => {
    const next = data?.mode as PermissionMode | undefined;
    if (next && next in modeLabel) setMode(next, lastCtx);
  });

  pi.on("session_start", async (_event, ctx) => {
    lastCtx = ctx;
    settings = loadPermissions();
    showMode(ctx);
    // Quem carregou depois precisa saber o modo atual.
    pi.events.emit(MODE_CHANGED, { mode });
  });

  pi.registerShortcut("shift+tab", {
    description: "Ciclar modo de permissão",
    handler: (ctx) => {
      lastCtx = ctx;
      const index = modeCycle.indexOf(mode);
      // Fora do ciclo (sem-confirmacao) volta para o começo.
      setMode(modeCycle[(index + 1) % modeCycle.length] ?? modeCycle[0], ctx);
    },
  });

  pi.on("tool_call", async (event, ctx) => {
    lastCtx = ctx;
    const verdict = judge(event.toolName, (event as any).input, mode, settings);
    if (verdict.decision === "allow") return undefined;

    if (verdict.decision === "deny") {
      if (ctx.hasUI) ctx.ui.notify(`Bloqueado: ${verdict.reason}`, "warning");
      return { block: true, reason: `Permissões: ${verdict.reason}` };
    }

    if (!ctx.hasUI) {
      return { block: true, reason: `Permissões: ${verdict.reason} — sem UI para confirmar` };
    }

    const target = targetOf(event.toolName, (event as any).input);
    const options = ["Permitir uma vez", `Sempre permitir — ${verdict.suggestion}`, "Bloquear"];
    const choice = await queueDialog(() =>
      ctx.ui.select(`⚠️ ${verdict.reason}`, options, { timeout: dialogTimeoutMs }),
    );

    if (choice === options[0]) return undefined;
    if (choice === options[1]) {
      try {
        persistRule("allow", verdict.suggestion);
        settings = loadPermissions();
        ctx.ui.notify(`Regra gravada: ${verdict.suggestion}`, "info");
      } catch (error) {
        ctx.ui.notify(`Não consegui gravar a regra: ${error instanceof Error ? error.message : String(error)}`, "error");
      }
      return undefined;
    }

    // Bloquear, cancelar (undefined) e timeout caem aqui: fail-safe.
    return { block: true, reason: `Bloqueado pelo usuário: ${target || event.toolName}` };
  });

  // O bash digitado pelo usuário não passa por tool_call. Aqui só as regras destrutivas
  // valem — o usuário é quem está pedindo, então caminhos sensíveis não perguntam.
  pi.on("user_bash", async (event, ctx) => {
    if (mode === "sem-confirmacao") return undefined;
    const danger = destructiveBash.find(({ pattern }) => pattern.test(event.command));
    if (!danger) return undefined;

    const blocked = (output: string) => ({ result: { output, exitCode: 1, cancelled: false, truncated: false } });
    if (!ctx.hasUI) return blocked(`Bloqueado sem UI para confirmação: ${danger.label}`);

    const ok = await queueDialog(() =>
      ctx.ui.confirm(
        `⚠️ Comando perigoso: ${danger.label}`,
        `Você quer executar:\n\n${event.command}\n\nPermitir?`,
        { timeout: dialogTimeoutMs },
      ),
    );
    return ok ? undefined : blocked("Bloqueado pelo usuário");
  });

  pi.registerCommand("permissions", {
    description: "Modo de permissão e regras (allow/ask/deny)",
    handler: async (args, ctx) => {
      lastCtx = ctx;
      const arg = args.trim();

      if (arg) {
        const wanted = arg.toLowerCase() as PermissionMode;
        if (!(wanted in modeLabel)) {
          ctx.ui.notify(`Modo desconhecido: ${arg}. Use: ${Object.keys(modeLabel).join(", ")}`, "error");
          return;
        }
        if (wanted === "sem-confirmacao") {
          const ok = await ctx.ui.confirm(
            "⚠️ Desligar todas as confirmações?",
            "Nada mais será confirmado nesta sessão — incluindo rm -rf, escrita em .git e leitura de segredos.\n\nContinuar?",
          );
          if (!ok) return;
        }
        setMode(wanted, ctx);
        ctx.ui.notify(`Modo: ${modeLabel[mode]}`, "info");
        return;
      }

      settings = loadPermissions();
      const section = (title: string, rules: string[]) =>
        `${title}:\n${rules.length ? rules.map((r) => `  ${r}`).join("\n") : "  (nenhuma)"}`;
      ctx.ui.notify(
        [
          `Modo: ${modeLabel[mode]}   (Shift+Tab cicla: ${modeCycle.map((m) => modeLabel[m]).join(" → ")})`,
          "",
          section("deny", settings.deny),
          section("ask", settings.ask),
          section("allow", settings.allow),
          "",
          `Regras em ${settingsFile()} (chave "permissions").`,
          "Trocar de modo: /permissions <modo>",
        ].join("\n"),
        "info",
      );
    },
  });
}
