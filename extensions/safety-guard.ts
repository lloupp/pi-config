import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";

const destructiveBashPatterns: Array<{ pattern: RegExp; label: string }> = [
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

// Segredos: protegidos em leitura, escrita/edição e bash.
const secretPathPatterns: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /(^|\/)\.env(?:\.|$)/i, label: "arquivo .env" },
  { pattern: /(^|\/)\.ssh(?:\/|$)/i, label: "chaves SSH" },
  { pattern: /(^|\/)auth\.json$/i, label: "auth.json" },
  { pattern: /(^|\/)credentials\.json$/i, label: "credentials.json" },
  { pattern: /\.pem$/i, label: "certificado/chave .pem" },
  { pattern: /(^|\/)id_(?:rsa|ed25519)(?:\.pub)?$/i, label: "chave privada SSH" },
];

// Infra: protegida só em escrita/edição — ler é legítimo e frequente.
const infraPathPatterns: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /(^|\/)\.git(?:\/|$)/i, label: "diretório .git" },
  { pattern: /(^|\/)node_modules(?:\/|$)/i, label: "node_modules" },
];

async function confirmOrBlock(ctx: any, title: string, body: string) {
  if (!ctx.hasUI) return { block: true, reason: `${title}: bloqueado sem UI para confirmação` };

  const ok = await ctx.ui.confirm(title, body);
  if (!ok) return { block: true, reason: "Bloqueado pelo usuário" };
  return undefined;
}

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (isToolCallEventType("bash", event)) {
      const command = event.input.command;

      const danger = destructiveBashPatterns.find(({ pattern }) => pattern.test(command));
      if (danger) {
        return confirmOrBlock(
          ctx,
          `⚠️ Comando perigoso: ${danger.label}`,
          `O agente quer executar:\n\n${command}\n\nPermitir?`,
        );
      }

      // Fecha a brecha de ler segredos por bash (cat/grep/less .env, id_rsa etc.).
      // Tokeniza o comando para reusar os padrões ancorados em caminho: um token
      // isolado como `.env` casa por `^`, `server.pem` casa por `$`.
      const tokens = command.split(/[\s;|&><()"'`=]+/).filter(Boolean);
      const secret = secretPathPatterns.find(({ pattern }) =>
        tokens.some((token: string) => pattern.test(token)),
      );
      if (secret) {
        return confirmOrBlock(
          ctx,
          `⚠️ Acesso a arquivo sensível: ${secret.label}`,
          `O agente quer executar:\n\n${command}\n\nPermitir?`,
        );
      }

      return undefined;
    }

    if (isToolCallEventType("read", event)) {
      const path = event.input.path;
      const match = secretPathPatterns.find(({ pattern }) => pattern.test(path));
      if (!match) return undefined;

      return confirmOrBlock(
        ctx,
        `⚠️ Leitura de arquivo sensível: ${match.label}`,
        `O agente quer ler:\n\n${path}\n\nPermitir?`,
      );
    }

    if (isToolCallEventType("write", event) || isToolCallEventType("edit", event)) {
      const path = event.input.path;
      const match = [...secretPathPatterns, ...infraPathPatterns].find(({ pattern }) =>
        pattern.test(path),
      );
      if (!match) return undefined;

      if (ctx.hasUI) ctx.ui.notify(`Proteção: ${path} (${match.label})`, "warning");
      return { block: true, reason: `Caminho protegido: ${path} (${match.label})` };
    }

    return undefined;
  });

  pi.on("user_bash", async (event, ctx) => {
    const match = destructiveBashPatterns.find(({ pattern }) => pattern.test(event.command));
    if (!match) return undefined;

    if (!ctx.hasUI) {
      return {
        result: {
          output: `Bloqueado sem UI para confirmação: ${match.label}`,
          exitCode: 1,
          cancelled: false,
          truncated: false,
        },
      };
    }

    const ok = await ctx.ui.confirm(
      `⚠️ Comando perigoso: ${match.label}`,
      `Você quer executar:\n\n${event.command}\n\nPermitir?`,
    );

    if (!ok) {
      return {
        result: {
          output: "Bloqueado pelo usuário",
          exitCode: 1,
          cancelled: false,
          truncated: false,
        },
      };
    }

    return undefined;
  });
}
