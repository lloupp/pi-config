import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

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
const safeBash = /^(pwd|ls|find|fd|rg|grep|git (status|diff|log|show|branch)|npm (test|run|ls)|node --version|python --version|pip --version|cat |head |tail |wc |du |df |jq |sed -n|awk )/;

function cloneTasks(tasks: Task[]) {
  return tasks.map((task) => ({ ...task }));
}

function renderTasks(tasks: Task[]) {
  if (tasks.length === 0) return "Sem tarefas.";
  return tasks.map((t) => `[${t.done ? "x" : " "}] #${t.id} ${t.text}`).join("\n");
}

export default function (pi: ExtensionAPI) {
  let planMode = false;
  let activeBeforePlan: string[] | undefined;
  let tasks: Task[] = [];
  let nextId = 1;

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
        ctx.ui.theme.fg("dim", "Ferramentas de escrita bloqueadas. Use /implement para liberar."),
      ]);
    } else {
      ctx.ui.setStatus("plan-tasks", undefined);
      ctx.ui.setWidget("plan-tasks", undefined);
    }
  }

  function enablePlan(ctx: ExtensionContext) {
    if (!planMode) activeBeforePlan = pi.getActiveTools();
    planMode = true;
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

  pi.on("session_start", async (_event, ctx) => {
    reconstructTasks(ctx);
    updatePlanUi(ctx);
  });
  pi.on("session_tree", async (_event, ctx) => {
    reconstructTasks(ctx);
    updatePlanUi(ctx);
  });

  pi.registerCommand("plan", {
    description: "Ativa modo plano: análise sem escrita e instruções para criar plano",
    handler: async (args, ctx) => {
      enablePlan(ctx);
      const objective = args?.trim() || "a tarefa solicitada";
      pi.sendUserMessage(`Modo plano ativo. Analise o projeto e crie um plano para: ${objective}\n\nNão edite arquivos ainda. Termine com uma seção 'Plano:' numerada e riscos/validações.`);
    },
  });

  pi.registerCommand("implement", {
    description: "Sai do modo plano e pede para implementar o plano atual",
    handler: async (args, ctx) => {
      disablePlan(ctx);
      if (ctx.hasUI) ctx.ui.notify("Modo implementação: ferramentas anteriores restauradas.", "info");
      const extra = args?.trim() ? `\nInstruções extras: ${args.trim()}` : "";
      pi.sendUserMessage(`Implemente o plano aprovado em passos pequenos. Use task_list para acompanhar progresso. Rode validações quando possível.${extra}`);
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
        content: `[MODO PLANO ATIVO]\n- Não edite nem escreva arquivos.\n- Use leitura, busca e git status/diff para entender o contexto.\n- Bash deve ser apenas investigativo.\n- Produza um plano numerado, riscos e comandos de validação.\n- Aguarde /implement antes de alterar arquivos.`,
        display: false,
      },
    };
  });

  pi.on("tool_call", async (event) => {
    if (!planMode) return undefined;
    if (event.toolName === "write" || event.toolName === "edit") {
      return { block: true, reason: "Modo plano ativo: escrita bloqueada. Use /implement para liberar." };
    }
    if (event.toolName === "bash") {
      const command = String((event.input as any).command ?? "").trim();
      if (!safeBash.test(command)) {
        return { block: true, reason: `Modo plano ativo: bash não permitido: ${command}` };
      }
    }
    return undefined;
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
