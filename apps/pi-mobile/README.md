# Pi Mobile — aplicativo Android para o Pi Agent

App Android independente, com identificador **`com.lloupp.pimobile`**, diferente de `com.termux` para não colidir com instalações do Termux.

## Arquitetura

- **Android (Java + WebView):** interface de chat, mensagens transmitidas durante a resposta, histórico, modelos, novas conversas, interrupção, e login por token local.
- **Termux (Node):** servidor HTTP que escuta **somente** `127.0.0.1:8765`; repassa os comandos seguros de controle ao `pi --mode rpc` por JSONL (sem APIs externas).
- **Configuração:** utiliza diretamente `lloupp/pi-config`: `AGENTS.md`, `extensions/`, `skills/`, `prompts/`. Não versiona nem transporta API keys.

**Esta é uma versão de app + Termux; o APK não incorpora o runtime Pi.** Não funciona sem o Termux ativo. Essa escolha evita o conflito de identificador do Pocket Pi sem recompilar toda a base nativa do Termux.

## Instalação no telefone

1. Instale o [Termux do GitHub](https://github.com/termux/termux-app/releases) ou F-Droid e abra-o.
2. No Termux, copie e execute:

```bash
pkg update -y && pkg install -y git
cd ~
git clone https://github.com/lloupp/pi-config.git pi-config
bash ~/pi-config/apps/pi-mobile/termux/install.sh
```

> **Se estiver instalando a partir do ZIP local**, copie os arquivos da pasta `apps/pi-mobile` para dentro do checkout `~/pi-config` antes de executar `install.sh`. Preferencialmente use a versão do GitHub após integrar a PR.

3. Configure seu modelo/chave pelo Pi no Termux (ex.: OpenRouter). O instalador do `pi-config` não substitui suas credenciais ou `settings.json`.
4. Inicie o serviço em uma sessão Termux e mantenha-o aberto:

```bash
bash ~/pi-config/apps/pi-mobile/termux/start.sh
```

5. Copie a chave mostrada após `Your app access token:` (ou `cat ~/.pi/agent/pi-mobile.token`).
6. Instale o APK de uma execução **Pi Mobile APK** nas Actions do repositório (Artifacts → `pi-mobile-debug-apk`). Abra Pi Mobile e cole a chave.

**Observação:** `install.sh` cria backup de recursos atuais antes de executar o instalador existente, que espelha `extensions`, `skills` e `prompts` e remove extras não presentes no repositório.

## Compilar o APK

O GitHub Actions compila `:app:assembleDebug` ao enviar mudanças para o `master` ou ao rodar **Run workflow**. Também é possível abrir `apps/pi-mobile/android` no Android Studio (JDK 17, SDK 35). APK: `android/app/build/outputs/apk/debug/app-debug.apk`.

Pacote Android: `com.lloupp.pimobile`. A assinatura debug não é apropriada para distribuir uma versão de produção.

## Segurança e limites

- Servidor ligado apenas ao loopback, não alcançável por Wi-Fi.
- Token aleatório (arquivo `~/.pi/agent/pi-mobile.token`, permissão 0600) exigido em todos os controles; navegador de outros sites bloqueado por Origin e header customizado.
- Token salvo apenas no armazenamento local do aplicativo Android, nunca incluído no GitHub.
- Sem AccessibilityService, captura de tela, controle remoto ou permissões sensíveis. Nenhum código do Pocket Pi anterior foi reutilizado.
- Não concede mais poder que o Pi executado no próprio Termux; o agente **pode ler, editar e executar comandos nos arquivos a que o Termux tem acesso**.
- O serviço precisa estar ativo para que o app funcione; sistema pode suspender Termux em segundo plano. Prova de instalação em telefone físico ainda é necessária.

## Referência de integração

Usa comandos RPC oficiais `prompt`, `get_state`, `get_messages`, `get_available_models`, `set_model`, `new_session` e `abort`, com eventos `message_update`, `message_end` e `agent_settled`. Documentação: https://pi.dev/docs/latest/rpc

## Rodar testes

```bash
node --test apps/pi-mobile/tests/*.test.cjs
```
