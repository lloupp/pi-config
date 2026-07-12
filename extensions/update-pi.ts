import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as os from "node:os";
import * as path from "node:path";

const gitTimeoutMs = 120_000;
const installTimeoutMs = 60_000;
const fetchTimeoutMs = 15_000;

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
    description: "Atualiza o pi-config: git pull no repo, reinstala em ~/.pi/agent e recarrega",
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

      const before = await pi.exec("git", ["-C", repo, "rev-parse", "HEAD"], { timeout: gitTimeoutMs });
      const pull = await pi.exec("git", ["-C", repo, "pull", "--ff-only"], { timeout: gitTimeoutMs });
      if (pull.code !== 0) {
        ctx.ui.notify(`git pull falhou:\n${(pull.stderr || pull.stdout).trim()}`, "error");
        return;
      }

      const after = await pi.exec("git", ["-C", repo, "rev-parse", "HEAD"], { timeout: gitTimeoutMs });
      let newCommits = "já estava atualizado";
      if (before.stdout.trim() !== after.stdout.trim()) {
        const log = await pi.exec("git", ["-C", repo, "log", "--oneline", `${before.stdout.trim()}..HEAD`], { timeout: gitTimeoutMs });
        newCommits = `commits novos:\n${log.stdout.trim()}`;
      }

      const install = await pi.exec("bash", [path.join(repo, "install-pi-config.sh"), "--global", repo], { timeout: installTimeoutMs });
      if (install.code !== 0) {
        ctx.ui.notify(`Instalação falhou:\n${(install.stderr || install.stdout).trim()}`, "error");
        return;
      }

      ctx.ui.notify(`pi-config atualizado (${newCommits})\n${install.stdout.trim()}`, "info");
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
      // Mesma lista de itens de configuração do install-pi-config.sh.
      const items = ["AGENTS.md", "settings.json", "mcp.json", "prompts", "skills", "extensions", "themes"];

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
        const copy = await pi.exec("sh", ["-c", `test -e ${JSON.stringify(src)} && cp -r ${JSON.stringify(src)} ${JSON.stringify(repo + "/")} || true`], { timeout: installTimeoutMs });
        if (copy.code !== 0) {
          ctx.ui.notify(`Falha copiando ${item}:\n${(copy.stderr || "").trim()}`, "error");
          return;
        }
      }

      const changed = await pi.exec("git", ["-C", repo, "status", "--porcelain"], { timeout: gitTimeoutMs });
      if (!changed.stdout.trim()) {
        ctx.ui.notify("Nada a sincronizar: o repo já reflete o ~/.pi/agent atual.", "info");
        return;
      }

      const host = os.hostname() || "local";
      const files = changed.stdout.trim().split("\n").map((l) => l.slice(3)).slice(0, 8).join(", ");
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
