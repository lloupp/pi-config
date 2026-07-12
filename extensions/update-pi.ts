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
}
