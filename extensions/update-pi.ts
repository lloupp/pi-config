import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const gitTimeoutMs = 120_000;
const installTimeoutMs = 60_000;
const testTimeoutMs = 180_000;
const fetchTimeoutMs = 15_000;

function pathEntryExists(target: string): boolean {
  try {
    fs.lstatSync(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return false;
    throw error;
  }
}

/**
 * Espelha um arquivo/diretório sem apagar o destino antes da cópia terminar.
 * O staging e o backup ficam no mesmo diretório do destino para que os renames
 * sejam locais ao mesmo filesystem. Se a ativação falhar, restaura o destino antigo.
 */
export function mirrorPathAtomic(src: string, dest: string): void {
  const parent = path.dirname(dest);
  const base = path.basename(dest);
  fs.mkdirSync(parent, { recursive: true });

  const txnDir = fs.mkdtempSync(path.join(parent, `.${base}.sync-`));
  const staged = path.join(txnDir, "staged");
  const backup = path.join(txnDir, "backup");
  let originalMoved = false;
  let preserveTxn = false;

  try {
    // Cópia completa primeiro. Se falhar, o destino ainda não foi tocado.
    fs.cpSync(src, staged, { recursive: true });

    if (pathEntryExists(dest)) {
      fs.renameSync(dest, backup);
      originalMoved = true;
    }

    try {
      fs.renameSync(staged, dest);
    } catch (commitError) {
      if (originalMoved && pathEntryExists(backup)) {
        try {
          fs.renameSync(backup, dest);
          originalMoved = false;
        } catch (rollbackError) {
          // Não apaga o backup se nem o rollback conseguiu recolocá-lo no destino.
          preserveTxn = true;
          throw new Error(
            `Falha ativando ${dest} e também restaurando o destino anterior. ` +
              `Backup preservado em ${backup}. Ativação: ${commitError instanceof Error ? commitError.message : String(commitError)}. ` +
              `Rollback: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
          );
        }
      }
      throw commitError;
    }
  } finally {
    if (!preserveTxn) fs.rmSync(txnDir, { recursive: true, force: true });
  }
}

export default function (pi: ExtensionAPI) {
  // Ao iniciar a sessão, verifica em segundo plano se o repo remoto tem
  // commits novos e avisa para rodar /update-pi. Falhas (offline, sem repo,
  // sem upstream) são silenciosas — o aviso só aparece quando há atualização.
  async function checkForUpdates(ctx: any) {
    const repo = path.join(os.homedir(), "pi-config");

    const fetch = await pi.exec("git", ["-C", repo, "fetch", "--quiet"], { timeout: fetchTimeoutMs });
    if (fetch.code !== 0) return;

    const behind = await pi.exec("git", ["-C", repo, "rev-list", "--count", "HEAD..@{u}"], { timeout: gitTimeoutMs });
    if (behind.code !== 0) return;
    const count = parseInt(behind.stdout.trim(), 10);
    if (!count) return;

    const log = await pi.exec("git", ["-C", repo, "log", "--oneline", "HEAD..@{u}"], { timeout: gitTimeoutMs });
    const commits = log.code === 0 ? `\n${log.stdout.trim()}` : "";
    ctx.ui.notify(
      `pi-config tem ${count} atualização(ões) disponível(is) — rode /update-pi para aplicar.${commits}`,
      "warning",
    );
  }

  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;
    void checkForUpdates(ctx).catch(() => {});
  });

  pi.registerCommand("update-pi", {
    description: "Atualiza o pi-config: git pull, testa, reinstala em ~/.pi/agent e recarrega",
    handler: async (args, ctx) => {
      const repo = (args ?? "").trim() || path.join(os.homedir(), "pi-config");

      const status = await pi.exec("git", ["-C", repo, "status", "--porcelain"], { timeout: gitTimeoutMs });
      if (status.code !== 0) {
        ctx.ui.notify(`Não é um repo git válido: ${repo}\n${(status.stderr || "").trim()}`, "error");
        return;
      }
      if (status.stdout.trim()) {
        ctx.ui.notify(`Repo com mudanças locais não commitadas — abortando para não perder trabalho:\n${status.stdout.trim()}`, "warning");
        return;
      }

      // Fetch e confirmação ANTES do pull: cancelar não pode deixar o repo à frente do que
      // está instalado, senão o aviso de atualização do início da sessão some para sempre.
      const fetch = await pi.exec("git", ["-C", repo, "fetch", "--quiet"], { timeout: gitTimeoutMs });
      if (fetch.code !== 0) {
        ctx.ui.notify(`git fetch falhou:\n${(fetch.stderr || fetch.stdout).trim()}`, "error");
        return;
      }
      const log = await pi.exec("git", ["-C", repo, "log", "--oneline", "HEAD..@{u}"], { timeout: gitTimeoutMs });
      const newCommits = log.code === 0 && log.stdout.trim() ? `commits novos:\n${log.stdout.trim()}` : "já estava atualizado";

      // Tanto a suíte quanto o instalador vêm do remoto e executam código.
      // O usuário confirma UMA vez, vendo os commits, antes de qualquer execução deles.
      if (ctx.hasUI) {
        const ok = await ctx.ui.confirm(
          "Atualizar, validar e instalar o pi-config?",
          `Vai fazer git pull em ${repo}, executar run-tests.sh e, somente se tudo passar, install-pi-config.sh para sobrescrever ~/.pi/agent.\n\n${newCommits}\n\nContinuar?`,
        );
        if (!ok) {
          ctx.ui.notify("Atualização cancelada. Nada foi alterado.", "info");
          return;
        }
      }

      const pull = await pi.exec("git", ["-C", repo, "pull", "--ff-only"], { timeout: gitTimeoutMs });
      if (pull.code !== 0) {
        ctx.ui.notify(`git pull falhou:\n${(pull.stderr || pull.stdout).trim()}`, "error");
        return;
      }

      const tests = await pi.exec("bash", [path.join(repo, "run-tests.sh")], { timeout: testTimeoutMs });
      if (tests.code !== 0 || tests.killed) {
        ctx.ui.notify(
          `Atualização NÃO instalada: a suíte falhou após o pull. ~/.pi/agent foi preservado.\n${(tests.stderr || tests.stdout || `exit ${tests.code}`).trim()}`,
          "error",
        );
        return;
      }

      const install = await pi.exec("bash", [path.join(repo, "install-pi-config.sh"), "--global", repo], { timeout: installTimeoutMs });
      if (install.code !== 0) {
        ctx.ui.notify(`Instalação falhou:\n${(install.stderr || install.stdout).trim()}`, "error");
        return;
      }

      ctx.ui.notify(`pi-config atualizado e validado (${newCommits})\n${install.stdout.trim()}`, "info");
      await ctx.reload();
    },
  });

  // O inverso do /update-pi: leva as modificações locais de ~/.pi/agent para o
  // repo ~/pi-config, commita e faz push — fecha o ciclo de sincronização entre máquinas.
  pi.registerCommand("sync-pi", {
    description: "Sincroniza ~/.pi/agent → repo ~/pi-config, commita e faz push",
    handler: async (args, ctx) => {
      const repo = (args ?? "").trim() || path.join(os.homedir(), "pi-config");
      const agentDir = path.join(os.homedir(), ".pi", "agent");
      // Mesma lista de itens do install-pi-config.sh. O settings.json fica de fora nos dois
      // sentidos: provider, modelos e pacotes são escolha de cada máquina, e sincronizá-los
      // faria uma máquina sobrescrever a escolha da outra.
      const items = ["AGENTS.md", "prompts", "skills", "extensions"];

      const status = await pi.exec("git", ["-C", repo, "status", "--porcelain"], { timeout: gitTimeoutMs });
      if (status.code !== 0) {
        ctx.ui.notify(`Não é um repo git válido: ${repo}\n${(status.stderr || "").trim()}`, "error");
        return;
      }
      if (status.stdout.trim()) {
        ctx.ui.notify(`Repo já tem mudanças não commitadas — resolva-as antes do /sync-pi:\n${status.stdout.trim()}`, "warning");
        return;
      }

      for (const item of items) {
        const src = path.join(agentDir, item);
        if (!pathEntryExists(src)) continue;
        const dest = path.join(repo, item);
        try {
          // Staging no mesmo filesystem: arquivos removidos continuam sumindo no espelho,
          // mas uma falha de cópia não apaga o destino que já estava válido.
          mirrorPathAtomic(src, dest);
        } catch (error) {
          ctx.ui.notify(`Falha espelhando ${item}: ${error instanceof Error ? error.message : String(error)}`, "error");
          return;
        }
      }

      const changed = await pi.exec("git", ["-C", repo, "status", "--porcelain"], { timeout: gitTimeoutMs });
      if (!changed.stdout.trim()) {
        ctx.ui.notify("Nada a sincronizar: o repo já reflete o ~/.pi/agent atual.", "info");
        return;
      }

      const host = os.hostname() || "local";
      const files = changed.stdout.trimEnd().split("\n").map((l) => l.slice(3)).slice(0, 8).join(", ");
      await pi.exec("git", ["-C", repo, "add", "-A"], { timeout: gitTimeoutMs });
      const commit = await pi.exec("git", ["-C", repo, "commit", "-m", `Sync de ${host}: ${files}`], { timeout: gitTimeoutMs });
      if (commit.code !== 0) {
        ctx.ui.notify(`Commit falhou:\n${(commit.stderr || commit.stdout).trim()}`, "error");
        return;
      }

      // Rebase antes do push: se outra máquina publicou commits, os locais vão por cima.
      const pull = await pi.exec("git", ["-C", repo, "pull", "--rebase"], { timeout: gitTimeoutMs });
      if (pull.code !== 0) {
        await pi.exec("git", ["-C", repo, "rebase", "--abort"], { timeout: gitTimeoutMs });
        ctx.ui.notify(
          `Conflito com o remoto — o commit local foi mantido, mas o push não foi feito.\nResolva manualmente no repo (git pull --rebase) e depois git push.\n${(pull.stderr || pull.stdout).trim()}`,
          "warning",
        );
        return;
      }

      const push = await pi.exec("git", ["-C", repo, "push"], { timeout: gitTimeoutMs });
      if (push.code !== 0) {
        ctx.ui.notify(`Push falhou (o commit local está salvo):\n${(push.stderr || push.stdout).trim()}`, "error");
        return;
      }

      ctx.ui.notify(`Sincronizado e publicado: ${files}`, "info");
    },
  });
}
