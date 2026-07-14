/**
 * mcp.ts — cliente MCP (Model Context Protocol) para o Pi.
 *
 * O Pi não tem MCP embutido (decisão do autor); esta extensão adiciona suporte
 * a servidores MCP via transporte stdio, sem dependências externas: o protocolo
 * é JSON-RPC 2.0 delimitado por linha, implementado à mão.
 *
 * Configuração (mesmo formato do Claude Desktop/Code):
 *   ~/.pi/agent/mcp.json   (global)  e/ou  .pi/mcp.json  (projeto; sobrepõe por nome)
 *
 *   {
 *     "mcpServers": {
 *       "playwright": {
 *         "command": "npx",
 *         "args": ["@playwright/mcp@latest", "--browser=chrome"],
 *         "env": {},
 *         "enabled": true,
 *         "timeoutMs": 120000
 *       }
 *     }
 *   }
 *
 * Cada ferramenta do servidor vira uma tool do Pi chamada mcp_<servidor>_<tool>.
 * Nenhum servidor conecta sozinho: a extensão só liga quando o usuário digita
 * /mcp start (ou /mcp reload). Comandos: /mcp (status), /mcp start, /mcp stop,
 * /mcp reload.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PROTOCOL_VERSION = "2025-06-18";
const HANDSHAKE_TIMEOUT_MS = 30_000;
const DEFAULT_CALL_TIMEOUT_MS = 120_000;
const MAX_RESULT_CHARS = 50_000;
const STDERR_RING_SIZE = 20;

interface ServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled?: boolean;
  timeoutMs?: number;
}

interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

interface Pending {
  resolve: (value: any) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

function sanitizeName(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^_+|_+$/g, "") || "tool";
}

function truncate(text: string, max = MAX_RESULT_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n[... truncado: ${text.length - max} caracteres omitidos]`;
}

/** Cliente MCP sobre stdio: JSON-RPC 2.0, uma mensagem por linha. */
class McpClient {
  private child: ChildProcess | undefined;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private stdoutBuffer = "";
  private stderrLines: string[] = [];
  connected = false;
  tools: McpToolInfo[] = [];
  serverInfo: { name?: string; version?: string } = {};
  readonly name: string;
  private config: ServerConfig;

  constructor(name: string, config: ServerConfig) {
    this.name = name;
    this.config = config;
  }

  get callTimeoutMs(): number {
    return this.config.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    const child = spawn(this.config.command, this.config.args ?? [], {
      env: { ...process.env, ...(this.config.env ?? {}) },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;

    child.stdout!.setEncoding("utf8");
    child.stdout!.on("data", (chunk: string) => this.onStdout(chunk));
    child.stderr!.setEncoding("utf8");
    child.stderr!.on("data", (chunk: string) => {
      for (const line of chunk.split("\n")) {
        if (!line.trim()) continue;
        this.stderrLines.push(line);
        if (this.stderrLines.length > STDERR_RING_SIZE) this.stderrLines.shift();
      }
    });
    child.on("exit", (code) => {
      this.connected = false;
      const err = new Error(`Servidor MCP '${this.name}' encerrou (código ${code}).`);
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(err);
      }
      this.pending.clear();
    });
    child.on("error", (err) => {
      this.connected = false;
      const wrapped = new Error(`Falha ao iniciar servidor MCP '${this.name}': ${err.message}`);
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(wrapped);
      }
      this.pending.clear();
    });

    const initResult = await this.request(
      "initialize",
      {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "pi-mcp-extension", version: "0.1.0" },
      },
      HANDSHAKE_TIMEOUT_MS,
    );
    this.serverInfo = initResult?.serverInfo ?? {};
    this.notify("notifications/initialized", {});
    this.connected = true;

    // tools/list com paginação por cursor.
    const tools: McpToolInfo[] = [];
    let cursor: string | undefined;
    do {
      const res = await this.request("tools/list", cursor ? { cursor } : {}, HANDSHAKE_TIMEOUT_MS);
      tools.push(...(res?.tools ?? []));
      cursor = res?.nextCursor;
    } while (cursor);
    this.tools = tools;
  }

  async callTool(toolName: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<any> {
    if (!this.connected) {
      throw new Error(`Servidor MCP '${this.name}' não está conectado. Use /mcp start.`);
    }
    return this.request("tools/call", { name: toolName, arguments: args }, this.callTimeoutMs, signal);
  }

  stop(): void {
    this.connected = false;
    const child = this.child;
    this.child = undefined;
    // child.killed vira true assim que kill() é chamado (não quando o processo morre),
    // então a escalação decide só por exitCode.
    if (child && child.exitCode === null) {
      child.kill("SIGTERM");
      setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      }, 3000).unref?.();
    }
  }

  lastStderr(): string {
    return this.stderrLines.join("\n");
  }

  private onStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    let newlineIndex: number;
    while ((newlineIndex = this.stdoutBuffer.indexOf("\n")) >= 0) {
      const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (!line) continue;
      let msg: any;
      try {
        msg = JSON.parse(line);
      } catch {
        continue; // servidor logou lixo no stdout; ignore a linha
      }
      if (typeof msg?.id === "number" && ("result" in msg || "error" in msg)) {
        const pending = this.pending.get(msg.id);
        if (!pending) continue;
        this.pending.delete(msg.id);
        clearTimeout(pending.timer);
        if (msg.error) {
          pending.reject(new Error(`MCP '${this.name}': ${msg.error.message ?? JSON.stringify(msg.error)}`));
        } else {
          pending.resolve(msg.result);
        }
      }
      // Requests/notifications vindos do servidor (sampling, logging) são ignorados.
    }
  }

  private send(payload: Record<string, unknown>): void {
    if (!this.child?.stdin?.writable) {
      throw new Error(`Servidor MCP '${this.name}' não está aceitando escrita (processo morto?).`);
    }
    this.child.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  private notify(method: string, params: Record<string, unknown>): void {
    this.send({ jsonrpc: "2.0", method, params });
  }

  private request(
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const cleanup = () => signal?.removeEventListener("abort", onAbort);
      const timer = setTimeout(() => {
        this.pending.delete(id);
        cleanup();
        reject(new Error(`MCP '${this.name}': timeout de ${timeoutMs}ms em ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          cleanup();
          resolve(value);
        },
        reject: (err) => {
          cleanup();
          reject(err);
        },
        timer,
      });
      const onAbort = () => {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        clearTimeout(pending.timer);
        try {
          this.notify("notifications/cancelled", { requestId: id, reason: "abortado pelo usuário" });
        } catch {
          // processo pode já ter morrido; nada a fazer
        }
        pending.reject(new Error(`MCP '${this.name}': chamada ${method} abortada.`));
      };
      if (signal) {
        if (signal.aborted) return onAbort();
        signal.addEventListener("abort", onAbort, { once: true });
      }
      try {
        this.send({ jsonrpc: "2.0", id, method, params });
      } catch (err) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(err as Error);
      }
    });
  }
}

function loadConfigs(cwd: string): Record<string, ServerConfig> {
  const merged: Record<string, ServerConfig> = {};
  const paths = [join(homedir(), ".pi", "agent", "mcp.json"), join(cwd, ".pi", "mcp.json")];
  for (const path of paths) {
    if (!existsSync(path)) continue;
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8"));
      for (const [name, cfg] of Object.entries(parsed?.mcpServers ?? {})) {
        merged[name] = cfg as ServerConfig;
      }
    } catch (err) {
      throw new Error(`mcp: erro lendo ${path}: ${(err as Error).message}`);
    }
  }
  return merged;
}

/** Converte o content de um resultado MCP para o formato de content do Pi. */
function convertContent(result: any): { content: any[]; isError: boolean } {
  const out: any[] = [];
  for (const item of result?.content ?? []) {
    if (item?.type === "text" && typeof item.text === "string") {
      out.push({ type: "text", text: truncate(item.text) });
    } else if (item?.type === "image" && typeof item.data === "string") {
      out.push({ type: "image", data: item.data, mimeType: item.mimeType ?? "image/png" });
    } else if (item?.type === "resource" && item.resource) {
      const r = item.resource;
      const text = typeof r.text === "string" ? r.text : `[recurso binário: ${r.uri ?? "sem uri"}]`;
      out.push({ type: "text", text: truncate(text) });
    } else if (item) {
      out.push({ type: "text", text: truncate(JSON.stringify(item)) });
    }
  }
  if (out.length === 0) out.push({ type: "text", text: "(resultado vazio)" });
  return { content: out, isError: result?.isError === true };
}

export default function mcpExtension(pi: ExtensionAPI) {
  const clients = new Map<string, McpClient>();
  const registeredTools = new Set<string>();
  /** Nomes de tool (mcp_<servidor>_<tool>) já registrados para cada servidor, para poder ativar/desativar. */
  const toolsByServer = new Map<string, Set<string>>();

  function registerServerTools(client: McpClient): string[] {
    const added: string[] = [];
    const bucket = toolsByServer.get(client.name) ?? new Set<string>();
    toolsByServer.set(client.name, bucket);
    for (const tool of client.tools) {
      const piName = `mcp_${sanitizeName(client.name)}_${sanitizeName(tool.name)}`;
      bucket.add(piName);
      if (registeredTools.has(piName)) continue;
      registeredTools.add(piName);
      added.push(piName);

      const schema =
        tool.inputSchema && (tool.inputSchema as any).type === "object"
          ? tool.inputSchema
          : { type: "object", properties: {} };
      const serverName = client.name;
      const mcpToolName = tool.name;

      pi.registerTool({
        name: piName,
        label: `MCP ${serverName}: ${mcpToolName}`,
        description: `[MCP ${serverName}] ${tool.description ?? mcpToolName}`,
        parameters: schema as any,
        async execute(_toolCallId, params, signal) {
          const details = { server: serverName, tool: mcpToolName };
          const current = clients.get(serverName);
          if (!current) {
            return {
              content: [{ type: "text", text: `Servidor MCP '${serverName}' não está ativo. Use /mcp start.` }],
              isError: true,
              details,
            };
          }
          try {
            const result = await current.callTool(mcpToolName, (params ?? {}) as Record<string, unknown>, signal);
            const { content, isError } = convertContent(result);
            return { content, isError, details };
          } catch (err) {
            const stderr = current.lastStderr();
            const extra = stderr ? `\nstderr recente do servidor:\n${truncate(stderr, 2000)}` : "";
            return {
              content: [{ type: "text", text: `${(err as Error).message}${extra}` }],
              isError: true,
              details,
            };
          }
        },
      });
    }
    return added;
  }

  /** Ativa as tools mcp_* dos servidores dados, preservando o restante das tools ativas. */
  function activateServers(names: Iterable<string>): void {
    const toActivate = new Set<string>();
    for (const name of names) for (const t of toolsByServer.get(name) ?? []) toActivate.add(t);
    if (toActivate.size === 0) return;
    const active = new Set(pi.getActiveTools());
    for (const t of toActivate) active.add(t);
    pi.setActiveTools([...active]);
  }

  /** Desativa (some da lista de tools disponíveis) as tools mcp_* dos servidores dados. */
  function deactivateServers(names: Iterable<string>): void {
    const toDeactivate = new Set<string>();
    for (const name of names) for (const t of toolsByServer.get(name) ?? []) toDeactivate.add(t);
    if (toDeactivate.size === 0) return;
    const active = pi.getActiveTools().filter((t) => !toDeactivate.has(t));
    pi.setActiveTools(active);
  }

  /**
   * Conecta os servidores pedidos (ou todos os configurados, se `only` for omitido).
   * `only` filtra por nome; nomes que não existem no mcp.json viram "não encontrado" no resumo.
   */
  async function connectServers(cwd: string, only?: string[]): Promise<string[]> {
    const summary: string[] = [];
    const configs = loadConfigs(cwd);
    const configured = Object.keys(configs).filter((n) => configs[n].enabled !== false);
    const names = only ? only : configured;

    for (const name of names) {
      if (only && !configured.includes(name)) {
        summary.push(
          configs[name]
            ? `✗ ${name}: desativado (enabled: false) em mcp.json`
            : `✗ ${name}: não encontrado em mcp.json`,
        );
        continue;
      }
      if (clients.get(name)?.connected) {
        summary.push(`= ${name}: já estava conectado`);
        continue;
      }
      clients.get(name)?.stop();
      const client = new McpClient(name, configs[name]);
      clients.set(name, client);
      try {
        await client.connect();
        const added = registerServerTools(client);
        activateServers([name]);
        summary.push(`✓ ${name}: ${client.tools.length} tools (${added.length} novas)`);
      } catch (err) {
        clients.delete(name);
        client.stop();
        const stderr = client.lastStderr();
        summary.push(`✗ ${name}: ${(err as Error).message}${stderr ? ` | stderr: ${stderr.slice(-300)}` : ""}`);
      }
    }
    if (names.length === 0) {
      summary.push("Nenhum servidor MCP configurado (crie ~/.pi/agent/mcp.json ou .pi/mcp.json).");
    }
    return summary;
  }

  /** Desconecta os servidores pedidos (ou todos os conectados, se `only` for omitido). */
  function stopServers(only?: string[]): string[] {
    const targets = only ? only.filter((n) => clients.has(n)) : [...clients.keys()];
    const notFound = only ? only.filter((n) => !clients.has(n)) : [];
    deactivateServers(targets);
    for (const name of targets) {
      clients.get(name)?.stop();
      clients.delete(name);
    }
    return [...targets.map((n) => `✓ ${n}`), ...notFound.map((n) => `✗ ${n}: não estava conectado`)];
  }

  // Nenhuma conexão automática no início da sessão: MCP só liga quando o usuário
  // digitar /mcp start (ou /mcp reload). Assim as tools mcp_* nem aparecem para o
  // modelo até serem explicitamente acionadas.
  pi.on("session_shutdown", () => {
    stopServers();
  });

  pi.registerCommand("mcp", {
    description:
      "MCP sob demanda: /mcp start [servidor] liga (todos ou um só), /mcp stop [servidor] desliga, " +
      "/mcp reload [servidor] reconecta, /mcp status mostra estado",
    handler: async (args, ctx) => {
      const cwd = ctx.cwd;
      const parts = args.trim().split(/\s+/).filter(Boolean);
      const cmd = (parts[0] ?? "").toLowerCase();
      const target = parts[1]; // nome de servidor opcional
      const only = target ? [target] : undefined;

      // loadConfigs/connectServers lançam se um mcp.json estiver malformado; capturamos
      // aqui para que um JSON inválido não derrube o comando (inclusive o /mcp status).
      try {
        if (cmd === "start" || cmd === "on") {
          const summary = await connectServers(cwd, only);
          ctx.ui.notify(`MCP start: ${summary.join(" · ")}`, "info");
          return;
        }

        if (cmd === "stop" || cmd === "off") {
          if (clients.size === 0) {
            ctx.ui.notify("MCP: já estava desligado.", "info");
            return;
          }
          const summary = stopServers(only);
          ctx.ui.notify(`MCP stop: ${summary.join(" · ")}. Tools mcp_* correspondentes desativadas.`, "info");
          return;
        }

        if (cmd === "reload") {
          stopServers(only);
          const summary = await connectServers(cwd, only);
          ctx.ui.notify(`MCP reload: ${summary.join(" · ")}`, "info");
          return;
        }

        if (clients.size === 0) {
          const configs = loadConfigs(cwd);
          const known = Object.keys(configs);
          const hint = known.length > 0 ? ` Configurados: ${known.join(", ")}.` : "";
          ctx.ui.notify(
            `MCP: desligado. Use /mcp start para ligar todos, ou /mcp start <servidor> para ligar só um.${hint}`,
            "info",
          );
          return;
        }
        const lines = [...clients.values()].map((c) => {
          const info = c.serverInfo.name ? ` (${c.serverInfo.name} ${c.serverInfo.version ?? ""})` : "";
          return `${c.connected ? "✓" : "✗"} ${c.name}${info}: ${c.tools.length} tools`;
        });
        ctx.ui.notify(`MCP:\n${lines.join("\n")}`, "info");
      } catch (err) {
        ctx.ui.notify(`MCP: erro — ${err instanceof Error ? err.message : String(err)}`, "error");
      }
    },
  });
}

// Exportado para testes fora do Pi (scratchpad); não é usado pelo runtime do Pi.
export { McpClient, convertContent, loadConfigs };
