import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

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

type GateChoice = "approve" | "edit" | "reject";
const gateOptions: { label: string; value: GateChoice }[] = [
  { label: "Aprovar e implementar", value: "approve" },
  { label: "Editar plano", value: "edit" },
  { label: "Rejeitar e continuar planejando", value: "reject" },
];

// Gate de aprovação com o plano rolável (padrão do question.ts oficial): o título do
// ctx.ui.select é estático e um plano longo estoura a tela do Termux sem scroll.
// ↑↓/j/k rolam o plano; PgUp/PgDn/g/G saltam; ←→/Tab trocam a opção; Enter confirma;
// 1-3 escolhem direto; Esc rejeita.
async function planGate(ctx: ExtensionContext, plan: string, fileRel: string): Promise<GateChoice> {
  if (ctx.mode !== "tui") {
    // Sem TUI completa (ex.: RPC): cai no select simples com preview truncado.
    const lines = plan.split(/\r?\n/);
    const preview = lines.length > 40 ? lines.slice(0, 40).join("\n") + `\n… (íntegra em ${fileRel})` : plan;
    const choice = await ctx.ui.select(`Plano proposto (${fileRel}):\n\n${preview}\n\nO que fazer?`, gateOptions.map((o) => o.label));
    return gateOptions.find((o) => o.label === choice)?.value ?? "reject";
  }

  const result = await ctx.ui.custom<GateChoice | null>((tui, theme, _kb, done) => {
    const planLines = plan.split(/\r?\n/);
    const windowSize = 12;
    let offset = 0;
    let optionIndex = 0;
    let maxOffset = 0; // recalculado no render (depende da largura p/ wrap)
    let cached: string[] | undefined;

    function refresh() {
      cached = undefined;
      tui.requestRender();
    }

    function handleInput(data: string) {
      if (matchesKey(data, Key.up) || data === "k") { offset = Math.max(0, offset - 1); refresh(); return; }
      if (matchesKey(data, Key.down) || data === "j") { offset = Math.min(maxOffset, offset + 1); refresh(); return; }
      if (matchesKey(data, Key.pageUp) || data === "u") { offset = Math.max(0, offset - windowSize); refresh(); return; }
      if (matchesKey(data, Key.pageDown) || data === "d") { offset = Math.min(maxOffset, offset + windowSize); refresh(); return; }
      if (matchesKey(data, Key.home) || data === "g") { offset = 0; refresh(); return; }
      if (matchesKey(data, Key.end) || data === "G") { offset = maxOffset; refresh(); return; }
      if (matchesKey(data, Key.left)) { optionIndex = (optionIndex + gateOptions.length - 1) % gateOptions.length; refresh(); return; }
      if (matchesKey(data, Key.right) || matchesKey(data, Key.tab)) { optionIndex = (optionIndex + 1) % gateOptions.length; refresh(); return; }
      if (data >= "1" && data <= String(gateOptions.length)) { done(gateOptions[Number(data) - 1].value); return; }
      if (matchesKey(data, Key.enter)) { done(gateOptions[optionIndex].value); return; }
      if (matchesKey(data, Key.escape)) { done(null); return; }
    }

    function render(width: number): string[] {
      if (cached) return cached;
      const w = Math.max(20, width);
      const wrapped = planLines.flatMap((l) => wrapTextWithAnsi(l || " ", w - 2));
      maxOffset = Math.max(0, wrapped.length - windowSize);
      if (offset > maxOffset) offset = maxOffset;
      const visible = wrapped.slice(offset, offset + windowSize);

      const lines: string[] = [];
      lines.push(theme.fg("accent", "─".repeat(w)));
      lines.push(theme.fg("accent", theme.bold(` Plano proposto (${fileRel})`)));
      lines.push("");
      for (const l of visible) lines.push(` ${l}`);
      if (wrapped.length > windowSize) {
        lines.push(theme.fg("dim", ` — linhas ${offset + 1}-${offset + visible.length} de ${wrapped.length} (↑↓ rolam) —`));
      }
      lines.push("");
      for (let i = 0; i < gateOptions.length; i++) {
        const sel = i === optionIndex;
        const marker = sel ? theme.fg("accent", "→ ") : "  ";
        const label = `${i + 1}. ${gateOptions[i].label}`;
        lines.push(` ${marker}${sel ? theme.fg("accent", label) : theme.fg("text", label)}`);
      }
      lines.push("");
      lines.push(theme.fg("dim", " ↑↓ rolar • ←→ opção • Enter confirmar • 1-3 direto • Esc rejeitar"));
      lines.push(theme.fg("accent", "─".repeat(w)));
      cached = lines;
      return lines;
    }

    return {
      render,
      invalidate: () => {
        cached = undefined;
      },
      handleInput,
    };
  });

  return result ?? "reject";
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

  // Diretório onde os planos vivem; a escrita no modo plano é liberada só aqui dentro.
  function plansDir(ctx: ExtensionContext) {
    return resolve(ctx.cwd, ".pi", "plans");
  }

  // True se `abs` é um arquivo DENTRO de .pi/plans/ (não o próprio dir, sem escapar via ..).
  function isInsidePlans(ctx: ExtensionContext, abs: string): boolean {
    const rel = relative(plansDir(ctx), abs);
    return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
  }

  // Persiste o estado do plano na sessão para sobreviver a retomadas (resume).
  function persistPlanState(ctx: ExtensionContext) {
    try {
      const slug = planFilePath ? basename(planFilePath, ".md") : undefined;
      pi.appendEntry("plan-tasks-state", { planMode, slug, planFileRel });
    } catch {
      /* sessão sem persistência disponível */
    }
  }

  // Restaura planFilePath/planFileRel e, se estava em modo plano, reativa o bloqueio de escrita.
  function restorePlanState(ctx: ExtensionContext) {
    const entries = ctx.sessionManager.getEntries();
    let found: { planMode?: boolean; slug?: string; planFileRel?: string } | undefined;
    for (const e of entries) {
      const entry = e as any;
      if (entry.type === "custom" && entry.customType === "plan-tasks-state") found = entry.data;
    }
    if (!found) return;
    planFileRel = found.planFileRel || planFileRel;
    if (found.slug) planFilePath = resolve(ctx.cwd, ".pi", "plans", `${found.slug}.md`);
    if (found.planMode) {
      planMode = true;
      if (activeBeforePlan === undefined) activeBeforePlan = pi.getActiveTools();
      pi.setActiveTools(planTools());
    }
    updatePlanUi(ctx);
  }

  // Reabre um plano salvo em .pi/plans/<slug>.md para revisão/implementação.
  function openPlan(ctx: ExtensionContext, slug?: string) {
    if (!slug) {
      ctx.ui.notify("Uso: /open-plan <slug>  (liste com /plans)", "warning");
      return;
    }
    const clean = slug.replace(/\.md$/, "");
    const target = resolve(ctx.cwd, ".pi", "plans", `${clean}.md`);
    if (!isInsidePlans(ctx, target)) {
      ctx.ui.notify(`Slug inválido: ${slug} — o plano deve ficar dentro de .pi/plans/ (sem barras nem "..").`, "error");
      return;
    }
    if (!existsSync(target)) {
      ctx.ui.notify(`Plano não encontrado: ${clean} (.pi/plans/${clean}.md)`, "error");
      return;
    }
    if (!planMode) activeBeforePlan = pi.getActiveTools();
    planMode = true;
    planFilePath = target;
    planFileRel = relative(ctx.cwd, target) || `${clean}.md`;
    mkdirSync(dirname(target), { recursive: true });
    pi.setActiveTools(planTools());
    updatePlanUi(ctx);
    persistPlanState(ctx);
    const content = readPlan();
    pi.sendUserMessage(
      `Reabrindo plano salvo em ${planFileRel}. O conteúdo atual está abaixo — revise, amplie ou ajuste e mantenha os passos numerados. ` +
        `Não edite outros arquivos. Quando estiver pronto, chame exit_plan para aprovar/implementar.\n\n---\n${content}`,
    );
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

  // Ferramentas do modo plano: mantém write/edit NO schema para que o agente possa gravar
  // o arquivo de plano; o bloqueio de outras gravações é feito pelo guard em tool_call,
  // não removendo as ferramentas (senão a exceção do arquivo de plano vira código morto).
  function planTools() {
    const set = new Set<string>([...readonlyTools, ...pi.getActiveTools()]);
    set.add("write");
    set.add("edit");
    return [...set];
  }

  function enablePlan(ctx: ExtensionContext, objective?: string) {
    if (!planMode) activeBeforePlan = pi.getActiveTools();
    planMode = true;
    const slug = slugify(objective ?? "") || "plano";
    planFilePath = resolve(ctx.cwd, ".pi", "plans", `${slug}.md`);
    planFileRel = relative(ctx.cwd, planFilePath) || `${slug}.md`;
    mkdirSync(dirname(planFilePath), { recursive: true });
    pi.setActiveTools(planTools());
    updatePlanUi(ctx);
    persistPlanState(ctx);
    if (ctx.hasUI) ctx.ui.notify("Modo plano ativo: gravação permitida só no arquivo de plano; demais escritas bloqueadas.", "info");
  }

  function disablePlan(ctx: ExtensionContext) {
    planMode = false;
    if (activeBeforePlan) pi.setActiveTools(activeBeforePlan);
    activeBeforePlan = undefined;
    updatePlanUi(ctx);
    persistPlanState(ctx);
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
    restorePlanState(ctx);
    updatePlanUi(ctx);
  });
  pi.on("session_tree", async (_event, ctx) => {
    reconstructTasks(ctx);
    restorePlanState(ctx);
    updatePlanUi(ctx);
  });

  pi.registerCommand("plan", {
    description: "Ativa modo plano: análise sem escrita, plano gravado em .pi/plans/<slug>.md",
    handler: async (args, ctx) => {
      const objective = args?.trim() || "a tarefa solicitada";
      enablePlan(ctx, args?.trim());
      const exists = planFilePath && existsSync(planFilePath);
      const base =
        `Escreva/atualize o plano no arquivo ${planFileRel} (é o ÚNICO arquivo que você pode gravar agora). ` +
        `Estruture com um objetivo curto, passos NUMERADOS (1., 2., ...), riscos e comandos de validação. ` +
        `Não edite mais nenhum arquivo. Quando o plano estiver pronto, chame a ferramenta exit_plan para apresentá-lo ao usuário e pedir aprovação.`;
      const msg = exists
        ? `Modo plano ativo. Já existe um plano em ${planFileRel} — revise e atualize-o (mantenha os passos numerados). ${base}`
        : `Modo plano ativo. Analise o projeto e crie um plano para: ${objective}\n\n${base}`;
      pi.sendUserMessage(msg);
    },
  });

  pi.registerCommand("implement", {
    description: "Aprova o plano atual: libera escrita e semeia tarefas",
    handler: async (args, ctx) => {
      const count = approve(ctx);
      persistPlanState(ctx);
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

  pi.registerCommand("open-plan", {
    description: "Reabre um plano salvo em .pi/plans/<slug>.md para revisão/implementação",
    handler: async (args, ctx) => {
      openPlan(ctx, args?.trim());
    },
  });

  pi.registerCommand("plans", {
    description: "Lista os planos salvos em .pi/plans/ (e abre um, se houver UI)",
    handler: async (_args, ctx) => {
      const dir = resolve(ctx.cwd, ".pi", "plans");
      if (!existsSync(dir)) {
        ctx.ui.notify("Nenhum plano salvo ainda (.pi/plans/ inexistente).", "info");
        return;
      }
      const files = readdirSync(dir)
        .filter((f) => f.endsWith(".md"))
        .sort((a, b) => statSync(join(dir, b)).mtimeMs - statSync(join(dir, a)).mtimeMs);
      if (files.length === 0) {
        ctx.ui.notify("Nenhum plano salvo ainda.", "info");
        return;
      }
      if (ctx.hasUI) {
        const choice = await ctx.ui.select(
          "Planos salvos — qual reabrir?",
          [...files.map((f) => f.replace(/\.md$/, "")), "Cancelar"],
        );
        if (choice && choice !== "Cancelar") openPlan(ctx, choice);
        return;
      }
      ctx.ui.notify(files.map((f) => "- " + f.replace(/\.md$/, "")).join("\n"), "info");
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
      // Libera qualquer arquivo DENTRO de .pi/plans/ (robusto a nome escolhido pelo agente
      // e seguro contra traversal), não só o caminho exato calculado no /plan.
      if (isInsidePlans(ctx, abs)) return undefined;
      return {
        block: true,
        reason: `Modo plano ativo: escrita bloqueada — só é permitido gravar dentro de .pi/plans/ (ex.: ${planFileRel}). Chame exit_plan quando o plano estiver pronto.`,
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
    // Dialogs (ctx.ui.select/input) dentro de execute exigem execução sequencial: em modo
    // paralelo (default do Pi), outro dialog concorrente (safety-guard, exit_plan duplicado)
    // sobrescreve o slot único da TUI e a Promise do primeiro nunca resolve — o turno trava.
    executionMode: "sequential",
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      if (!planMode) {
        return { content: [{ type: "text", text: "Não está em modo plano; nada a aprovar." }], details: undefined };
      }
      const plan = readPlan().trim();
      if (!plan) {
        return {
          content: [{ type: "text", text: `O arquivo de plano ${planFileRel} está vazio ou não existe. Escreva o plano nele antes de chamar exit_plan.` }],
          details: undefined,
        };
      }
      if (!ctx.hasUI) {
        const n = approve(ctx);
        persistPlanState(ctx);
        return { content: [{ type: "text", text: `Sem UI para confirmar: plano aprovado automaticamente. ${n} tarefa(s) criadas. Escrita liberada.` }], details: undefined };
      }

      while (true) {
        const choice = await planGate(ctx, readPlan().trim(), planFileRel);

        if (choice === "approve") {
          const n = approve(ctx);
          persistPlanState(ctx);
          return {
            content: [
              {
                type: "text",
                text:
                  `Plano aprovado pelo usuário. Escrita liberada e ${n} tarefa(s) criadas a partir do plano. ` +
                  `Implemente em passos pequenos, marcando cada tarefa concluída com task_list (action=done). Rode validações quando possível.`,
              },
            ],
            details: undefined,
          };
        }

        if (choice === "edit") {
          const edited = await ctx.ui.editor("Editar plano", readPlan());
          if (edited !== undefined) {
            writePlan(edited);
            persistPlanState(ctx);
            ctx.ui.notify("Plano atualizado.", "info");
          }
          continue; // reapresenta o gate
        }

        // Rejeitar (ou cancelado): coleta feedback e devolve o controle ao agente, ainda em modo plano.
        const feedback = (await ctx.ui.input("O que ajustar no plano? (enter para pular)", "")) ?? "";
        const msg = feedback.trim()
          ? `Usuário quer continuar no modo plano. Ajuste o plano em ${planFileRel} conforme o feedback: ${feedback.trim()}. Depois chame exit_plan de novo.`
          : `Usuário quer continuar no modo plano. Refine o plano em ${planFileRel} e chame exit_plan de novo quando pronto.`;
        return { content: [{ type: "text", text: msg }], details: undefined };
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
