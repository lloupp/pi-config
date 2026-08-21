// Infra compartilhada dos testes: carrega uma extensão do repo do mesmo jeito que o Pi
// carrega, com jiti e os mesmos virtualModules, e oferece um `pi` simulado.
//
// Rode a suíte com: node --test tests/
import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const extensionsDir = join(repoRoot, "extensions");

/**
 * Descobre a raiz do pacote @earendil-works/pi-coding-agent. O caminho varia por máquina
 * (versão do Node no diretório, Termux vs desktop), então nada aqui pode ser fixo:
 * 1. PI_PACKAGE_DIR, se o usuário quiser apontar manualmente;
 * 2. o binário `pi` do PATH, cujo realpath cai em <pkg>/dist/cli.js;
 * 3. o node_modules global do npm.
 */
function findPiPackage() {
  const fromEnv = process.env.PI_PACKAGE_DIR;
  if (fromEnv && existsSync(join(fromEnv, "dist", "index.js"))) return fromEnv;

  try {
    const bin = execFileSync("sh", ["-c", "command -v pi"], { encoding: "utf8" }).trim();
    if (bin) {
      // <pkg>/dist/cli.js → <pkg>
      const pkg = resolve(dirname(realpathSync(bin)), "..");
      if (existsSync(join(pkg, "dist", "index.js"))) return pkg;
    }
  } catch {
    // pi não está no PATH; tenta o npm global abaixo
  }

  try {
    const npmRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
    const pkg = join(npmRoot, "@earendil-works", "pi-coding-agent");
    if (existsSync(join(pkg, "dist", "index.js"))) return pkg;
  } catch {
    // sem npm no PATH
  }

  throw new Error(
    "Não encontrei o pacote @earendil-works/pi-coding-agent. Instale o pi ou aponte PI_PACKAGE_DIR para a raiz do pacote.",
  );
}

const piPackage = findPiPackage();

const { createJiti } = await import(`${piPackage}/node_modules/jiti/lib/jiti.mjs`);

// As extensões importam esses pacotes por nome, mas eles não são resolvíveis a partir de
// extensions/ — o loader do Pi os injeta como virtualModules e aqui fazemos o mesmo.
const virtualModules = {
  "@earendil-works/pi-coding-agent": await import(`${piPackage}/dist/index.js`),
  "@earendil-works/pi-tui": await import(`${piPackage}/node_modules/@earendil-works/pi-tui/dist/index.js`),
  typebox: await import(`${piPackage}/node_modules/typebox/build/index.mjs`),
  "typebox/compile": await import(`${piPackage}/node_modules/typebox/build/compile/index.mjs`),
  "typebox/value": await import(`${piPackage}/node_modules/typebox/build/value/index.mjs`),
};

const jiti = createJiti(`${piPackage}/dist/core/extensions/loader.js`, { virtualModules, tryNative: false });

/** Importa o módulo cru de uma extensão (para testar funções exportadas). */
export function importExtension(fileName) {
  return jiti.import(join(extensionsDir, fileName));
}

/**
 * Carrega a extensão e executa seu default export com um `pi` simulado, devolvendo o que
 * ela registrou: handlers de evento, comandos, tools e providers.
 */
export async function loadExtension(fileName) {
  const registered = { events: {}, commands: {}, tools: {}, providers: [], activeTools: [] };
  const pi = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "events") return new Proxy({}, { get: () => () => [] });
        return (...args) => {
          switch (prop) {
            case "on":
              registered.events[args[0]] = args[1];
              break;
            case "registerCommand":
              registered.commands[args[0]] = args[1].handler;
              break;
            case "registerTool":
              registered.tools[args[0].name] = args[0];
              break;
            case "registerProvider":
              registered.providers.push(args[0]?.name ?? args[0]);
              break;
            case "setActiveTools":
              registered.activeTools = args[0];
              break;
          }
          return [];
        };
      },
    },
  );

  const factory = await jiti.import(join(extensionsDir, fileName), { default: true });
  if (typeof factory !== "function") throw new Error(`${fileName}: default export não é uma função`);
  await factory(pi);
  return registered;
}

/** UI que não faz nada, para comandos que só notificam. */
export function makeUi(overrides = {}) {
  return {
    notify: () => {},
    setStatus: () => {},
    setWidget: () => {},
    setFooter: () => {},
    setHeader: () => {},
    confirm: async () => true,
    select: async () => null,
    input: async () => null,
    editor: async () => null,
    custom: async () => null,
    theme: { fg: (_color, text) => text, bg: (_color, text) => text, bold: (text) => text },
    ...overrides,
  };
}

/** Contexto de extensão mínimo. */
export function makeCtx(overrides = {}) {
  const { ui, ...rest } = overrides;
  return {
    cwd: repoRoot,
    hasUI: true,
    mode: "tui",
    ui: makeUi(ui),
    ...rest,
  };
}

/** Junta o texto dos blocos de content de um resultado de tool. */
export function contentText(result) {
  return result.content.map((block) => block.text ?? "").join("\n");
}
