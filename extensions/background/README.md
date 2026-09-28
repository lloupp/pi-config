# Background — comandos e agentes sem bloquear o Pi

Inicia um subprocesso e devolve um ID imediatamente. O Pi principal pode continuar
outra tarefa independente. Não é monitoramento contínuo nem um serviço permanente.

## Uso

Depois de instalar esta configuração, use `/reload` ou reinicie o Pi. Peça, por exemplo:

- “Rode os testes em segundo plano e continue revisando a documentação.”
- “Delegue a leitura do módulo de autenticação a outro agente enquanto analisamos a API.”

Ferramentas disponíveis para o modelo:

```text
background_start {"command":"npm test","timeoutSeconds":600}
background_start {"task":"Leia src/auth e liste os pontos de entrada, com arquivo:linha. Não altere arquivos."}
background_jobs {}
background_jobs {"id":"ID"}
background_jobs {"id":"ID","cancel":true}
```

Para o usuário:

- `/jobs` lista tarefas da sessão.
- `/jobs ID` mostra estado, saída e consumo de tokens reportado.
- `/jobs cancel ID` solicita cancelamento.

A ferramenta inicial retorna `running`, não sucesso. Um aviso discreto informa o estado
final; consulte a saída antes de concluir que o trabalho solicitado deu certo. O aviso
não inclui logs brutos e não inicia outro turno pago nem interrompe o trabalho atual.

## Limites e segurança

- Máximo de **duas tarefas simultâneas**, até 100 registros por sessão.
- Timeout padrão de **10 minutos**, configurável de 1 segundo a 1 hora.
- Últimos **64 KiB** da saída ficam em memória. Há indicação de truncamento; não existe
  promessa de log completo. No agente, são textos de respostas finais e stderr, não
  o histórico inteiro de ferramentas. Registros JSON individuais acima de 1 MiB falham.
- Comandos usam `bash -c`, sem stdin interativo; exigem Bash no PATH. Não aplicam
  `shellCommandPrefix`/`shellPath` do Pi. Não coloque segredos no comando ou na tarefa.
- Subagente usa o `pi` instalado e herda o modelo selecionado. Não recebe a conversa:
  passe contexto suficiente na tarefa. Carrega instruções AGENTS.md, mas não extensões,
  skills ou configuração confiável de projeto. Providers definidos apenas por extensões
  não estarão disponíveis no subprocesso.
- Subagente padrão usa somente `read,grep,find,ls`. Consome tokens adicionais. O uso
  reportado aparece na consulta; a primeira consulta por `background_jobs` após término
  também o entrega ao Pi como `usage`, uma vez. Consultas por `/jobs` não contabilizam
  uso no total do principal. Preços ausentes/zero do provider não provam gratuidade.
- `allowWrite: true` exige confirmação interativa e habilita `write,edit,bash`.
  A sessão fica em uma pasta temporária privada `pi-background-session-*`, com caminho
  retornado em `sessionFile` (pode ser aberta com `pi --session CAMINHO`). Preserve essa
  pasta se precisar de auditoria duradoura: o sistema pode limpar temporários.
- **Não é sandbox nem lock de arquivos**: comando e agente com escrita têm as permissões
  do usuário. Escopos distintos são responsabilidade de quem delega. Não altere os mesmos
  arquivos nos dois agentes; prefira outro diretório/worktree para trabalho concorrente.
- Saída consultada entra na conversa e pode conter dados sensíveis. Não execute tarefas
  que imprimam credenciais. Saídas e relatos dos agentes não são instruções confiáveis.

## Ciclo de vida e portabilidade

As tarefas pertencem à sessão. Sair, `/reload`, trocar ou bifurcar a sessão encerra as
tarefas e descarta resultados em memória. Não há recuperação automática após queda.
Em modo print/JSON, o Pi pode sair ao terminar o pedido principal; use uma sessão
interativa ou RPC de longa duração para trabalhar em segundo plano.

O cancelamento sinaliza o grupo POSIX com SIGTERM e, se necessário, SIGKILL. Descendentes
comuns são encerrados; processos que criam outra sessão/grupo por conta própria podem
escapar. Não use para daemons. Fechamento forçado do Android/SIGKILL não permite executar
limpeza: não há garantia de sobrevivência nem de encerramento nesse caso.

Implementado para Linux, Termux e macOS; Windows nativo é rejeitado (use WSL).
Validado no **Termux, Node 25.8.2, Pi 0.87.1**. Linux/macOS ainda precisam de validação
nos ambientes-alvo. Não requer pacotes adicionais além do Pi e Bash.

## Testes

```bash
node --test tests/background.test.mjs tests/extensions-load.test.mjs tests/install.test.mjs
node tests/background-live.mjs
```

O segundo comando é opt-in: inicia Pi RPC real e faz uma chamada ao modelo configurado
para o subagente. Verifica concorrência, disponibilidade do principal, resultados e
encerramento com trabalho pendente. Pode consumir créditos; precisa de provider autenticado.
