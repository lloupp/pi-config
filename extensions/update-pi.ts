import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as os from "node:os";
import * as path from "node:path";

const gitTimeoutMs = 120_000;
const installTimeoutMs = 60_000;

export default function (pi: ExtensionAPI) {
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
