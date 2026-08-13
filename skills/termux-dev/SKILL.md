---
name: termux-dev
description: "Diretrizes para desenvolvimento em Termux/Android, sem sudo nem systemd, usando pkg e caminhos do Termux. Inclui proot-distro para glibc, gerenciamento de versões Python/Node, troubleshooting de rede e wake-lock para tarefas longas. Use quando o usuário pedir ajuda com Termux, Android, instalação de pacotes, shell ou ambiente de desenvolvimento no celular."
compatibility: Termux/Android.
---

# Termux Dev

Use esta skill quando o usuário pedir ajuda com Termux, Android, instalação de pacotes, shell,
ambiente de desenvolvimento ou comandos Linux no celular.

## Diretrizes gerais

- Para configurar teclado, corretor, gestos ou integração com o Android (termux-api), invoque a
  skill `termux-integration` — ela tem o procedimento executável com backup.
- Lembre que o ambiente é Termux, sem `sudo` e normalmente sem systemd.
- Use `pkg`/`apt` do Termux; rode `pkg update` antes de instalar quando a instalação falhar por
  índice velho.
- Prefira caminhos sob `/data/data/com.termux/files/home` e `$PREFIX`.
- **Não existe `/tmp`**: use `$TMPDIR` (fica sob `$PREFIX/tmp`). Scripts que assumem `/tmp` quebrem.
- Tenha cuidado com armazenamento externo; sugira `termux-setup-storage` quando necessário (arquivos
  do Android ficam em `~/storage/`).
- Antes de instalar muitos pacotes, explique a finalidade de cada um.

## Wake-lock para tarefas longas

O Android mata o Termux em segundo plano para economizar bateria. **Antes de qualquer tarefa
que vá durar mais que ~5 minutos** (builds, pip install pesado, loops do agente, test suites):

```bash
termux-wake-lock                    # acquiring: CPU não dorme
# ... tarefa longa ...
termux-wake-unlock                  # liberar quando terminar
```

Esquecer o unlock causa drain de bateria — sempre pare em pares. Se o agent for executar
a tarefa, aplique o wake-lock antes e o unlock ao fim.

## proot-distro (Linux glibc dentro do Termux)

Muitas ferramentas exigem glibc (pandas, matplotlib, Docker, binários x86). O Termux usa
bionic libc — incompatível. `proot-distro` resolve rodando uma distro Linux completa dentro
do Termux sem root:

```bash
pkg install proot-distro            # instala o gerenciador
proot-distro list                   # distros disponíveis (ubuntu, debian, alpine, arch)
proot-distro install ubuntu         # baixa e instala Ubuntu
proot-distro login ubuntu           # entra no ambiente Ubuntu
```

Dentro do proot Ubuntu, você tem `apt`, `sudo`, glibc e pode instalar pacotes que não
funcionam no Termux nativo (pandas, matplotlib, Chrome, Docker se com pivoting).

### Montar diretórios do Termux no proot

```bash
proot-distro login ubuntu --bind ~/storage:~/storage --bind ~/workspace:~/workspace
```

### Casos de uso comuns

| Precisa de | Solução |
|---|---|
| pandas, matplotlib, numpy com C | proot-distro ubuntu + pip install |
| Docker | proot-distro + Docker com pivoting (experimental) |
| Chrome/Playwright | proot-distro ubuntu + apt install google-chrome |
| glibc binaries | proot-distro |
| Rodar sem overhead do proot | Termux nativo — prefira sempre que possível |

### Limitações do proot

- Overhead de sistema de arquivos (~10-30% mais lento que nativo).
- Sem acesso direto a `/dev` de hardware (sensores, câmera) — use termux-api no Termux nativo.
- Sem systemd — use `service` ou initscripts do proot.

## Gerenciamento de versões

### Python

O Termux vem com uma versão de Python (atualmente 3.14). Para múltiplas versões:

```bash
pkg install python                  # versão default do Termux
pkg install python-pip              # pip
python -m venv ~/meu-venv           # venv nativo (recomendado)
source ~/meu-venv/bin/activate
```

**Dentro do proot** Ubuntu, você pode usar `pyenv` para múltiplas versões:
```bash
proot-distro login ubuntu
curl https://pyenv.run | bash
pyenv install 3.12.0
pyenv install 3.14.0
pyenv global 3.14.0
```

### Node.js

```bash
pkg install nodejs                  # versão default do Termux (LTS recente)
pkg install nodejs-lts              # alternativa LTS se disponível
node --version
```

Para múltiplas versões de Node no Termux nativo, `nvm` funciona:
```bash
pkg install curl
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.nvm/nvm.sh
nvm install 22
nvm use 22
```

## Troubleshooting de rede

### pkg update falhando (mirror velho/down)

```bash
pkg update                          # se falhar, trocar mirror:
```

Editar `$PREFIX/etc/apt/sources.list` — usar mirror estável:
```
deb https://packages-cf.termux.dev/apt/termux-main stable main
```

Depois `pkg update` novamente.

### DNS intermitente

O Android pode fazer DOZE (economia de bateria) e cortar DNS em segundo plano:

```bash
# Verificar DNS atual
cat /etc/resolv.conf
# Testar resolução
nslookup google.com
# Se falhar intermitente, pode ser DOZE — use termux-wake-lock
```

### Downloads npm/pip lentos ou falhando

```bash
# npm: tentar registry alternativo
npm config set registry https://registry.npmmirror.com
# pip: mirror brasileiro
pip install --index-url https://pypi.org/simple/ pacote
# ou usar proot-distro que tem rede mais estável
```

### curl/ wget com SSL erro

```bash
pkg install ca-certificates          # certificados raiz atualizados
pkg install openssl                  # biblioteca SSL
```

## Armadilhas comuns

- **Builds nativos** (node-gyp, pacotes Python com C): exigem `pkg install build-essential python`
  (clang, make). Se um `npm install`/`pip install` falhar compilando, é quase sempre isso.
- **Binários x86/glibc não rodam**: Termux é Android/bionic (geralmente aarch64). Ferramentas
  distribuídas como binário Linux comum (muitos `npx` que baixam binários, Playwright/Chrome,
  Electron) **não funcionam nativamente** — inclusive o servidor MCP `playwright` do `mcp.json`,
  que só deve ser usado no Linux. Alternativas: versão via `pkg`, ou `proot-distro` para glibc.
- **Rede em segundo plano** e DNS podem variar entre Android/ROMs; erros intermitentes de rede
  às vezes são o Android dozing, não o servidor — `termux-wake-lock` resolve.
- **SIGILL (exit 132)**: instrução não suportada na CPU. Comum em ARM Cortex-A55 com esbuild/Vite
  (requerem SSE4.2). Use proot-distro ou alternativa nativa.
- **Armazenamento cheio**: `pkg clean` limpa cache apt; `npm cache clean --force` limpa cache npm;
  `du -sh .local .cache` mostra consumo.

## Integração com o Android (termux-api)

Com `pkg install termux-api` + app Termux:API instalado:
- `termux-notification -t "título" -c "corpo"` — avisar quando uma tarefa longa terminar;
- `termux-clipboard-get` / `termux-clipboard-set` — trocar texto com outros apps;
- `termux-battery-status` — checar bateria antes de builds pesados;
- `termux-wake-lock` / `termux-wake-unlock` — impedir Android de matar tarefas longas;
- `termux-toast` — mensagem rápida na tela;
- `termux-open --chooser arquivo` — abrir arquivo no app apropriado do Android.

Se os comandos travarem, o app Termux:API não está instalado — diga isso em vez de tentar de novo.

## Checklist

1. Verificar sistema: `uname -a`, `echo $PREFIX`, `pkg list-installed` quando útil (ou `/envcheck`).
2. Verificar ferramentas: `git`, `node`, `python`, `rg`, `fd`, `jq`.
3. Evitar instruções de desktop Linux incompatíveis (sudo, systemd, apt de distro, binários glibc).
4. Se a tarefa vai durar >5min: `termux-wake-lock` antes, `termux-wake-unlock` depois.
5. Se precisa glibc/pandas/Chrome: `proot-distro login ubuntu`.
6. Sugerir comandos curtos e copiáveis.

## Anti-padrões

- **Esquecer wake-lock em build longo**: o Android mata o Termux no meio e o usuário perde tudo.
- **Sugerir sudo**: não existe no Termux. Use `pkg` ou `proot-distro login` (sudo funciona dentro do proot).
- **Assumir /tmp**: não existe. Use `$TMPDIR`.
- **Tentar glibc nativo**: não funciona. Use proot-distro para isso.
- **Ignorar bateria**: `termux-battery-status` antes de builds pesados evita surpresas.
