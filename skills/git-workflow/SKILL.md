---
name: git-workflow
description: "Fluxo seguro de git: status/diff, conventional commits, padrões de branch, rebase vs merge, resolução de conflitos, git bisect para regressão, reflog para recovery e stash. Use quando o usuário pedir ajuda com git, commits, branches, PRs, changelog, resolução de conflitos ou análise de diff. Para auditoria de mudanças, use code-review; para reverter edições do agente, use /undo (checkpoint)."
compatibility: Termux/Android, Linux, repositórios Git.
---

# Git Workflow

Use esta skill quando o usuário pedir ajuda com git: commits, branches, diffs, PRs, conflitos, recovery ou changelog.

## Regras de segurança

- Sempre verifique `git status --short` antes de orientar mudanças.
- Não sobrescreva mudanças do usuário.
- Evite `git reset --hard`, `git clean -fd` e `git push --force` sem confirmação explícita.
- Não faça commit/push sem pedido explícito do usuário.
- Se houver alterações não relacionadas, não as misture no commit.

## Fluxo básico

1. **Status**: `git status --short` — ver o que mudou.
2. **Diff**: `git diff` (não-commitado) ou `git diff --staged` (staged).
3. **Explicar**: resuma as mudanças encontradas.
4. **Commit**: se solicitado, criar mensagem clara (Conventional Commits).
5. **Sequência**: se solicitado, sugerir comandos seguros na ordem certa.

## Conventional Commits

Formato: `<tipo>[escopo]: <descrição>`

### Tipos

| Tipo | Quando usar |
|---|---|
| `feat` | Nova funcionalidade |
| `fix` | Correção de bug |
| `docs` | Documentação apenas |
| `refactor` | Refatoração sem mudança de comportamento |
| `test` | Adição/correção de testes |
| `chore` | Tooling, config, dependências |
| `perf` | Melhoria de desempenho |
| `style` | Formatação, ponto e vírgula, espaços |
| `ci` | CI/CD |
| `build` | Sistema de build ou dependências |

### Exemplos

```bash
git commit -m "feat(auth): adiciona login via Google OAuth"
git commit -m "fix(api): corrige off-by-one na paginação de resultados"
git commit -m "docs: atualiza README com seção de instalação"
git commit -m "refactor(parser): extrai tokenizador para módulo separado"
git commit -m "test: cobre casos de borda do validador de email"
```

### Body (quando há mais de uma mudança)

```bash
git commit -m "feat: adiciona exportação para Excel e PDF

- Excel: usa openpyxl com gráficos embutidos
- PDF: usa reportlab com layout de duas colunas
- Adiciona testes para ambos formatos"
```

## Padrões de branch

| Padrão | Uso |
|---|---|
| `main` / `master` | produção estável |
| `feat/<desc>` | nova funcionalidade |
| `fix/<desc>` | correção de bug |
| `hotfix/<desc>` | correção urgente em produção |
| `refactor/<desc>` | refatoração |
| `docs/<desc>` | documentação |
| `chore/<desc>` | tooling/config |

### Fluxo de feature branch

```bash
git checkout -b feat/export-excel    # criar branch
# ... trabalhar ...
git add -p                            # stage interativo (revisarantes de commitar)
git commit -m "feat: exportação para Excel"
git push -u origin feat/export-excel  # push e set upstream
```

## Rebase vs Merge

### Merge (preserva histórico)

```bash
git checkout main
git merge feat/export-excel
# Cria merge commit. Hist fica com "ramificações".
```

Use merge quando: o histórico da branch é importante, muitos commits na feature.

### Rebase (histórico linear)

```bash
git checkout feat/export-excel
git rebase main                        # replaya seus commits em cima do main
# Resolve conflitos se houver, depois:
git checkout main
git merge feat/export-excel           # fast-forward (sem merge commit)
```

Use rebase quando: branch curta, poucos commits, quer histórico limpo.

**Nunca** rebase commits que já foram pushed e compartilhados com outros — rebase
reescreve histórico. Use rebase só em branches locais ou pessoais.

### Resolvendo conflitos

```bash
git status                            # mostra arquivos em conflito
# Edite os arquivos: remova <<<<<<< ======= >>>>>>> e escolha o código final
git add <arquivo>                     # marca como resolvido
git rebase --continue                 # ou: git merge --continue
git rebase --abort                    # desistir do rebase
```

## Git bisect (encontrar regressão)

Quando algo parou de funcionar e você não sabe qual commit quebrou:

```bash
git bisect start
git bisect bad                        # commit atual está quebrado
git bisect good <commit-hash>          # último commit conhecido que funcionava
# Git faz checkout do meio: teste o comportamento
git bisect good                       # se funciona neste commit
git bisect bad                        # se quebra neste commit
# Repita até git identificar o commit culpado
git bisect reset                      # voltar ao estado original
```

### Bisect automático (com script de teste)

```bash
git bisect start HEAD <commit-bom>
git bisect run npm test               # git roda npm test em cada commit
# automat grade até encontrar o culpado
git bisect reset
```

## Git stash (mudanças temporárias)

```bash
git stash                             # guarda mudanças não-commitadas
git stash -u                          # inclui arquivos não-rastreados
git stash list                        # ver stashes guardados
git stash pop                         # recuperar e remover o stash
git stash apply                       # recuperar e manter o stash
git stash drop                        # descartar stash sem recuperar
git stash clear                       # limpar todos os stashes
```

### Stash seletivo

```bash
git stash push -m "wip: auth refactor" src/auth.ts src/auth.test.ts
```

## Git reflog (recovery)

Reflog registra **todos** os movimentos de HEAD — mesmo commits que você "perdeu" com reset.

```bash
git reflog                            # ver histórico de HEAD
# abc1234 HEAD@{0}: reset: moving to HEAD~1
# def5678 HEAD@{1}: commit: feat: adiciona X
git checkout def5678                  # recuperar commit "perdido"
git checkout -b recovery              # criar branch a partir dele
```

### Recuperar branch deletada

```bash
git reflog | grep <nome-da-branch>
git checkout <hash-encontrado>
git checkout -b <nome>                # recriar branch
```

## Cherry-pick (trazer commit específico)

```bash
git cherry-pick <commit-hash>         # aplica commit específico na branch atual
git cherry-pick --no-commit <hash>    # aplica sem commitar (deixa staged)
git cherry-pick <hash1> <hash2>       # múltiplos commits
git cherry-pick --abort               # desistir
```

## Reword do último commit (antes do push)

```bash
git commit --amend -m "nova mensagem"    # mudar mensagem do último commit
git commit --amend --no-edit             # adicionar arquivos ao último commit
# CUIDADO: se já pushed, precisa git push --force (reescreve histórico)
```

## Verificar antes de push

```bash
git log --oneline origin/main..HEAD     # commits que vão ser pushed
git diff --stat origin/main..HEAD       # arquivos que mudaram
```

## Saída esperada

```
Status: <limpo/N arquivos modificados>
Branch: <nome>
Mudanças: <lista curta>
Commit sugerido: <tipo>(escopo): <descrição>
Próximos passos: <comandos>
```

## Anti-padrões

- **Commit gigante com mudanças não relacionadas**: um commit = um propósito. Use `git add -p` para stage seletivo.
- **Mensagem genérica** ("update", "fix bug", "wip"): o commit de amanhã é o log de hoje. Conventional Commits não é opcional.
- **Push --force em branch compartilhada**: reescreve histórico de outros. Use `--force-with-lease` (falha se alguém else pushed).
- **Reset --hard sem verificar status**: perde mudanças não-commitadas. Sempre `git status` antes.
- **Rebase em commits pushed compartilhados**: corrói o histórico do time. Rebase só em branch pessoal.
- **Ignorar conflitos**: conflito não resolvido = estado quebrado. Sempre `git status` depois de merge/rebase.
