import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

type TaskAction = "list" | "add" | "done" | "open" | "clear";
interface Task {
  id: number;
  text: string;
  done: boolean;
}
interface TaskDetails {
  action: TaskAction;
  tasks: Task[];
  nextId: number;
  error?: string;
}

const readonlyTools = ["read", "grep", "find", "ls", "project_snapshot"];
const blockedInPlan = new Set(["write", "edit"]);

// Comandos de leitura permitidos no modo plano (primeiro token).
const planBashAllowlist = new Set([
  "pwd", "ls", "find", "fd", "rg", "grep", "git", "npm", "node", "python", "python3",
  "pip", "cat", "head", "tail", "wc", "du", "df", "jq", "sed", "awk", "tree", "stat",
  "file", "which", "env",
]);

// Valida o comando INTEIRO (não por prefixo): sem encadeamento/redirecionamento/subshell,
// primeiro token no allowlist, e sem flags destrutivas mesmo em comandos "de leitura".
// Fecha o furo em que `pwd; rm -rf ~` ou `ls && curl|sh` passavam pelo filtro antigo.
function isSafePlanBash(cmd: string): boolean {
  const c = cmd.trim();
  if (!c) return false;
  if (/[;&|`$(){}<>\\]/.test(c) || /\n/.test(c)) return false; // metacaracteres de shell
  const first = c.split(/\s+/)[0];
  if (!planBashAllowlist.has(first)) return false;
  if (first === "find" && /\s-(delete|exec|execdir|ok|okdir|fprint|fprintf|fls)\b/.test(c)) return false;
  if ((first === "sed" || first === "awk") && /\s-i\b|\s-i\S/.test(c)) return false;
  if (first === "git" && !/^git\s+(status|diff|log|show|branch|ls-files|rev-parse|remote|blame|describe|shortlog|tag)\b/.test(c)) return false;
  if (first === "npm" && !/^npm\s+(test|run|ls|list|view|outdated|why)\b/.test(c)) return false;
  return true;
}

function cloneTasks(tasks: Task[]) {
  return tasks.map((task) => ({ ...task }));
}

function renderTasks(tasks: Task[]) {
  if (tasks.length === 0) return "Sem tarefas.";
  return tasks.map((t) => `[${t.done ? "x" : " "}] #${t.id} ${t.text}`).join("\n");
}

function slugify(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export default function (pi: ExtensionAPI) {
  let planMode = false;
  let activeBeforePlan: string[] | undefined;
  let tasks: Task[] = [];
  let nextId = 1;
  let planFilePath: string | undefined; // absoluto — único caminho gravável no modo plano
  let planFileRel = ".pi/plans/plano.md"; // para mensagens legíveis

  function readPlan() {
    if (planFilePath && existsSync(planFilePath)) return readFileSync(planFilePath, "utf8");
    return "";
  }

  function writePlan(content: string) {
    if (!planFilePath) return;
    mkdirSync(dirname(planFilePath), { recursive: true });
    writeFileSync(planFilePath, content, "utf8");
  }

  // Cria tarefas a partir das linhas numeradas de nível superior do plano (1. ... / 1) ...).
  function seedTasksFromPlan(content: string) {
    const items: string[] = [];
    for (const raw of content.split(/\r?\n/)) {
      const m = raw.match(/^\s*\d+[.)]\s+(.+\S)\s*$/);
      if (m) items.push(m[1].trim());
    }
    if (items.length === 0) return 0;
    tasks = items.map((text, i) => ({ id: i + 1, text, done: false }));
    nextId = items.length + 1;
    return items.length;
  }

  function reconstructTasks(ctx: ExtensionContext) {
    tasks = [];
    nextId = 1;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "message") continue;
      const msg = entry.message as any;
      if (msg.role !== "toolResult" || msg.toolName !== "task_list") continue;
      const details = msg.details as TaskDetails | undefined;
      if (!details) continue;
      tasks = cloneTasks(details.tasks);
      nextId = details.nextId;
    }
  }

  function updatePlanUi(ctx: ExtensionContext) {
    if (!ctx.hasUI) return;
    if (planMode) {
      ctx.ui.setStatus("plan-tasks", ctx.ui.theme.fg("warning", "📋 plan"));
      ctx.ui.setWidget("plan-tasks", [
        ctx.ui.theme.fg("warning", "Modo plano ativo"),
        ctx.ui.theme.fg("dim", `Escrita bloqueada (exceto ${planFileRel}). Chame exit_plan ou use /implement.`),
      ]);
    } else {
      ctx.ui.setStatus("plan-tasks", undefined);
      ctx.ui.setWidget("plan-tasks", undefined);
    }
  }

  function enablePlan(ctx: ExtensionContext, objective?: string) {
    if (!planMode) activeBeforePlan = pi.getActiveTools();
    planMode = true;
    const slug = slugify(objective ?? "") || "plano";
    planFilePath = resolve(ctx.cwd, ".pi", "plans", `${slug}.md`);
    planFileRel = relative(ctx.cwd, planFilePath) || `${slug}.md`;
    mkdirSync(dirname(planFilePath), { recursive: true });
    pi.setActiveTools([...new Set([...readonlyTools, ...pi.getActiveTools().filter((t) => !blockedInPlan.has(t))])]);
    updatePlanUi(ctx);
    if (ctx.hasUI) ctx.ui.notify("Modo plano ativado: escrita bloqueada, foco em análise e plano.", "info");
  }

  function disablePlan(ctx: ExtensionContext) {
    planMode = false;
    if (activeBeforePlan) pi.setActiveTools(activeBeforePlan);
    activeBeforePlan = undefined;
    updatePlanUi(ctx);
  }

  // Aprova o plano: libera escrita, semeia tarefas a partir do arquivo. Retorna nº de tarefas.
  function approve(ctx: ExtensionContext) {
    const count = seedTasksFromPlan(readPlan());
    disablePlan(ctx);
    if (ctx.hasUI) {
      ctx.ui.notify(
        count > 0
          ? `Modo implementação: escrita liberada. ${count} tarefa(s) criadas a partir do plano.`
          : "Modo implementação: escrita liberada.",
        "info",
      );
    }
    return count;
  }

  pi.on("session_start", async (_event, ctx) => {
    reconstructTasks(ctx);
    updatePlanUi(ctx);
  });
  pi.on("session_tree", async (_event, ctx) => {
    reconstructTasks(ctx);
    updatePlanUi(ctx);
  });

  pi.registerCommand("plan", {
    description: "Ativa modo plano: análise sem escrita, plano gravado em arquivo",
    handler: async (args, ctx) => {
      const objective = args?.trim() || "a tarefa solicitada";
      enablePlan(ctx, args?.trim());
      pi.sendUserMessage(
        `Modo plano ativo. Analise o projeto e crie um plano para: ${objective}\n\n` +
          `Escreva o plano no arquivo ${planFileRel} (é o ÚNICO arquivo que você pode gravar agora). ` +
          `Estruture com um objetivo curto, passos NUMERADOS (1., 2., ...), riscos e comandos de validação. ` +
          `Não edite mais nenhum arquivo. Quando o plano estiver pronto, chame a ferramenta exit_plan para apresentá-lo ao usuário e pedir aprovação.`,
      );
    },
  });

  pi.registerCommand("implement", {
    description: "Aprova o plano atual: libera escrita e semeia tarefas",
    handler: async (args, ctx) => {
      const count = approve(ctx);
      const extra = args?.trim() ? `\nInstruções extras: ${args.trim()}` : "";
      pi.sendUserMessage(
        `Plano aprovado. Implemente em passos pequenos, marcando cada tarefa com task_list (done). ` +
          `${count > 0 ? `Foram criadas ${count} tarefas a partir do plano.` : ""} Rode validações quando possível.${extra}`,
      );
    },
  });

  pi.registerCommand("tasks", {
    description: "Mostra tarefas da sessão atual",
    handler: async (_args, ctx) => {
      ctx.ui.notify(renderTasks(tasks), "info");
    },
  });

  pi.registerShortcut("ctrl+shift+p", {
    description: "Alternar modo plano",
    handler: async (ctx) => {
      if (planMode) {
        disablePlan(ctx);
        if (ctx.hasUI) ctx.ui.notify("Modo plano desativado.", "info");
      } else {
        enablePlan(ctx);
      }
    },
  });

  pi.on("before_agent_start", async () => {
    if (!planMode) return undefined;
    return {
      message: {
        customType: "plan-mode-context",
        content:
          `[MODO PLANO ATIVO]\n` +
          `- Não edite nem escreva arquivos, EXCETO o arquivo de plano: ${planFileRel}.\n` +
          `- Use leitura, busca e git status/diff para entender o contexto.\n` +
          `- Bash deve ser apenas investigativo; subagent apenas em mode=explore.\n` +
          `- Escreva no arquivo de plano: objetivo, passos NUMERADOS, riscos e comandos de validação.\n` +
          `- Quando o plano estiver pronto, chame a ferramenta exit_plan para pedir aprovação. Não altere outros arquivos até ser aprovado.`,
        display: false,
      },
    };
  });

  pi.on("tool_call", async (event, ctx) => {
    if (!planMode) return undefined;

    if (event.toolName === "write" || event.toolName === "edit") {
      const p = String((event.input as any).path ?? "");
      const abs = isAbsolute(p) ? resolve(p) : resolve(ctx.cwd, p);
      if (planFilePath && abs === planFilePath) return undefined; // exceção: arquivo de plano
      return {
        block: true,
        reason: `Modo plano ativo: escrita bloqueada (exceto ${planFileRel}). Chame exit_plan quando o plano estiver pronto.`,
      };
    }

    if (event.toolName === "subagent") {
      const mode = String((event.input as any).mode ?? "explore");
      if (mode === "full") {
        return { block: true, reason: "Modo plano ativo: subagent em mode=full bloqueado (pode editar). Use mode=explore." };
      }
    }

    if (event.toolName === "bash") {
      const command = String((event.input as any).command ?? "").trim();
      if (!isSafePlanBash(command)) {
        return { block: true, reason: `Modo plano ativo: bash não permitido (só leitura, sem encadeamento): ${command}` };
      }
    }

    return undefined;
  });

  // Equivalente ao ExitPlanMode do Claude Code: o agente chama quando o plano está pronto;
  // apresenta um gate de aprovação (Aprovar / Editar / Rejeitar) e só então libera a escrita.
  pi.registerTool({
    name: "exit_plan",
    label: "Exit Plan",
    description:
      "Apresenta o plano escrito ao usuário e pede aprovação. Chame quando o plano no arquivo estiver completo. Bloqueia até o usuário decidir. Só use em modo plano.",
    promptSnippet: "Apresenta o plano ao usuário para aprovar, editar ou rejeitar; libera a escrita ao aprovar.",
    promptGuidelines: [
      "Chame exit_plan somente depois de escrever o plano completo (objetivo, passos numerados, riscos, validações) no arquivo de plano.",
      "Se o usuário rejeitar, refine o plano conforme o feedback retornado e chame exit_plan de novo.",
    ],
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      if (!planMode) {
        return { content: [{ type: "text", text: "Não está em modo plano; nada a aprovar." }] };
      }
      if (!ctx.hasUI) {
        const n = approve(ctx);
        return { content: [{ type: "text", text: `Sem UI para confirmar: plano aprovado automaticamente. ${n} tarefa(s) criadas. Escrita liberada.` }] };
      }

      while (true) {
        const choice = await ctx.ui.select("Plano pronto — o que fazer?", [
          "Aprovar e implementar",
          "Editar plano",
          "Rejeitar e continuar planejando",
        ]);

        if (choice === "Aprovar e implementar") {
          const n = approve(ctx);
          return {
            content: [
              {
                type: "text",
                text:
                  `Plano aprovado pelo usuário. Escrita liberada e ${n} tarefa(s) criadas a partir do plano. ` +
                  `Implemente em passos pequenos, marcando cada tarefa concluída com task_list (action=done). Rode validações quando possível.`,
              },
            ],
          };
        }

        if (choice === "Editar plano") {
          const edited = await ctx.ui.editor("Editar plano", readPlan());
          if (edited !== undefined) {
            writePlan(edited);
            ctx.ui.notify("Plano atualizado.", "info");
          }
          continue; // reapresenta o gate
        }

        // Rejeitar (ou cancelado): coleta feedback e devolve o controle ao agente, ainda em modo plano.
        const feedback = (await ctx.ui.input("O que ajustar no plano? (enter para pular)", "")) ?? "";
        const msg = feedback.trim()
          ? `Usuário quer continuar no modo plano. Ajuste o plano em ${planFileRel} conforme o feedback: ${feedback.trim()}. Depois chame exit_plan de novo.`
          : `Usuário quer continuar no modo plano. Refine o plano em ${planFileRel} e chame exit_plan de novo quando pronto.`;
        return { content: [{ type: "text", text: msg }] };
      }
    },
  });

  pi.registerTool({
    name: "task_list",
    label: "Task List",
    description: "Gerencia uma lista de tarefas da sessão. Ações: list, add(text), done(id), open(id), clear.",
    promptSnippet: "Gerencia tarefas de implementação/revisão na sessão atual.",
    promptGuidelines: ["Use task_list para acompanhar progresso quando houver múltiplos passos ou plano de implementação."],
    parameters: Type.Object({
      action: Type.String({ description: "Ação: list, add, done, open ou clear" }),
      text: Type.Optional(Type.String({ description: "Texto para action=add" })),
      id: Type.Optional(Type.Number({ description: "ID para action=done/open" })),
    }),
    async execute(_id, params) {
      const action = params.action as TaskAction;
      let text = "";
      let error: string | undefined;

      if (action === "add") {
        if (!params.text?.trim()) error = "text obrigatório";
        else {
          const task = { id: nextId++, text: params.text.trim(), done: false };
          tasks.push(task);
          text = `Adicionada #${task.id}: ${task.text}`;
        }
      } else if (action === "done" || action === "open") {
        const task = tasks.find((t) => t.id === params.id);
        if (!task) error = `tarefa #${params.id} não encontrada`;
        else {
          task.done = action === "done";
          text = `${action === "done" ? "Concluída" : "Reaberta"} #${task.id}: ${task.text}`;
        }
      } else if (action === "clear") {
        const count = tasks.length;
        tasks = [];
        nextId = 1;
        text = `Removidas ${count} tarefas.`;
      } else {
        text = renderTasks(tasks);
      }

      if (error) text = `Erro: ${error}`;
      return {
        content: [{ type: "text", text: text || renderTasks(tasks) }],
        details: { action, tasks: cloneTasks(tasks), nextId, error } satisfies TaskDetails,
      };
    },
  });
}
