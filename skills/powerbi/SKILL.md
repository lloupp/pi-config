---
name: powerbi
description: "Gerar e preparar dados, modelos e medidas DAX para dashboards Power BI: criar arquivos .pbix proxy via XMLA, consultas Power Query (M), medidas DAX, datasource push via REST API e embed de relatórios. Use quando o usuário pedir para criar, editar ou automatizar relatórios Power BI, escrever DAX/Power Query, ou preparar dados para dashboards. Para gráficos embutidos em planilhas Excel, use excel-charts."
compatibility: Termux/Android (Python puro para DAX/M e dados), Linux com Power BI CLI (pbicli) e/ou .NET SDK. API REST Power BI requer Azure AD (register no portal). Power BI Desktop só roda em Windows/ARM.
---

# Power BI

Power BI é um ecossistema de BI da Microsoft com três camadas:

1. **Power Query (M)** — ETL: conectar, limpar e transformar dados
2. **DAX** — modelo semântico: medidas calculadas, KPIs, time intelligence
3. **Visual/Service** — relatórios e dashboards no service.powerbi.com

No Termux/Linux, o **Power BI Desktop não roda nativamente** (é Windows/ARM). Mas o agente
pode: preparar dados (CSV/Excel/SQL) para import, escrever DAX e M, chamar a REST API
do service, configurar embed e gerar templates de relatório (.pbit).

## Quando usar esta skill

- Escrever ou revisar medidas DAX
- Escrever ou revisar queries Power Query (M)
- Preparar dados (CSV/Excel/JSON/SQL) que vão alimentar um dataset Power BI
- Automatizar via REST API do Power BI (refresh, datasets, workspaces)
- Configurar embed de relatório (Power BI Embedded)
- Gerar templates .pbit

## Quando NÃO usar

- Para gráficos embutidos em Excel → `excel-charts`
- Para análise exploratória de dados em Python → pandas
- Para criar dashboards interativos web → veja Metabase/Superset como alternativa self-hosted

## Fase 1 — Preparar dados para Power BI

Power BI importa de muitas fontes; o agente pode preparar:

```python
import csv, json
import openpyxl  # se precisar de Excel

# CSV pronto para import
# Regras: header na linha 1, sem linhas vazias, datas em ISO (YYYY-MM-DD),
# números sem separador de milhar, tipos consistentes por coluna
with open("dados_vendas.csv", "w", newline="", encoding="utf-8") as f:
    writer = csv.DictWriter(f, fieldnames=["data", "produto", "regiao", "valor"])
    writer.writeheader()
    for row in dados:
        writer.writerow(row)

# Excel pronto para import (mais lento de processar no Power BI que CSV)
from openpyxl import Workbook
wb = Workbook(); ws = wb.active
ws.append(["data", "produto", "regiao", "valor"])
for r in dados:
    ws.append(r)
wb.save("dados.xlsx")
```

**Checklist de qualidade de dados para Power BI**:

- [ ] Nomes de colunas: sem espaços (use snake_case), sem acentos, sem caracteres especiais
- [ ] Datas em formato ISO (YYYY-MM-DD) ou DateTime que Power BI reconhece
- [ ] Números: separador decimal como ponto (configurável no Power BI, mas ISO é mais seguro)
- [ ] Sem linhas em branco no meio dos dados
- [ ] Uma coluna = um tipo (não misture texto e número na mesma coluna)
- [ ] Coluna de data/ano para time intelligence
- [ ] Chave primária sem duplicatas
- [ ] Para modelo estrela: fact table (números) + dimension tables (descrições)

## Fase 2 — Power Query (M)

Linguagem M de transformação de dados. Exemplos comuns:

### Conectar a CSV

```m
let
    Source = Csv.Document(
        File.Contents("C:\dados\vendas.csv"),
        [Delimiter=",", Encoding=65001, QuoteStyle=QuoteStyle.None]
    ),
    Promoted = Table.PromoteHeaders(Source),
    Typed = Table.TransformColumnTypes(Promoted, {
        {"data", type date},
        {"valor", type number},
        {"produto", type text}
    })
in
    Typed
```

### Conectar a planilha Excel

```m
let
    Source = Excel.Workbook(File.Contents("C:\dados\vendas.xlsx"), null, true),
    Sheet = Source{[Item="Vendas", Kind="Sheet"]}[Data],
    Promoted = Table.PromoteHeaders(Sheet),
    Filtered = Table.SelectRows(Promoted, each [valor] <> null and [valor] > 0)
in
    Filtered
```

### Coluna calculada

```m
Table.AddColumn(
    Source,
    "Margem",
    each [Receita] - [Custos],
    type number
)
```

### Pivot / Unpivot

```m
// Unpivot: transforma colunas de meses em linhas
Table.UnpivotOtherColumns(
    Source,
    {"produto"},    // colunas que ficam
    "mes",          // nome da coluna de atributo
    "valor"         // nome da coluna de valor
)
```

### Merge (join)

```m
Table.NestedJoin(
    vendas, {"produto_id"},
    produtos, {"id"},
    "produtos_join",
    JoinKind.Inner
)
```

## Fase 3 — DAX

### Medidas básicas

```dax
Total Receita = SUM(vendas[valor])

Ticket Médio = DIVIDE(
    [Total Receita],
    COUNTROWS(vendas),
    0    -- alternância se divisor = 0
)

Margem % = DIVIDE(
    SUM(vendas[receita]) - SUM(vendas[custos]),
    SUM(vendas[receita]),
    0
)
```

### Time intelligence

```dax
-- Ano atual
Receita YTD = TOTALYTD([Total Receita], calendario[data])

-- Mês anterior
Receita Mês Anterior = CALCULATE(
    [Total Receita],
    DATEADD(calendario[data], -1, MONTH)
)

-- Variação YoY
Variação YoY % = DIVIDE(
    [Total Receita] - [Receita Mês Anterior Ano],
    [Receita Mês Anterior Ano],
    0
)

-- Média móvel 3 meses
Média Móvel 3M = CALCULATE(
    AVERAGEX(
        DATESINPERIOD(calendario[data], MAX(calendario[data]), -3, MONTH),
        [Total Receita]
    )
)
```

### Filtros e contexto

```dax
-- FILTER: modificar o contexto de filtro
Top 5 Produtos = CALCULATE(
    [Total Receita],
    TOPN(
        5,
        VALUES(produtos[nome]),
        [Total Receita],
        DESC
    )
)

-- ALL: remover filtro de uma coluna
Receita Total = CALCULATE(
    [Total Receita],
    ALL(produtos)
)

-- ALLEXCEPT: remover todos exceto
Receita por Região = CALCULATE(
    [Total Receita],
    ALLEXCEPT(vendas, vendas[regiao])
)
```

### Coluna calculada vs medida

```dax
-- Coluna calculada: avaliada por linha, armazena no modelo
Classificação = SWITCH(
    TRUE(),
    vendas[valor] >= 10000, "Alto",
    vendas[valor] >= 5000, "Médio",
    "Baixo"
)

-- Medida: avaliada no contexto do visual, não armazena
Total Alto = CALCULATE(
    [Total Receita],
    FILTER(vendas, vendas[valor] >= 10000)
)
```

### Tabela calendário (essencial para time intelligence)

```dax
Calendario = ADDCOLUMNS(
    CALENDATA(
        DATE(2020, 1, 1),
        DATE(2025, 12, 31)
    ),
    "Ano", YEAR([Date]),
    "Mes", FORMAT([Date], "MMMM"),
    "MesNum", MONTH([Date]),
    "Trimestre", "Q" & QUARTER([Date]),
    "AnoMes", FORMAT([Date], "YYYY-MM")
)
```

## Fase 4 — REST API do Power BI

A API REST do Power BI permite: listar workspaces, datasets, triggers refresh, gerar embed tokens
e push data. Autenticação via Azure AD (OAuth 2.0).

### Autenticar (Azure AD)

```python
# Requer: python -m pip install msal
from msal import ConfidentialClientApplication
import requests, os

TENANT_ID = os.environ["PBI_TENANT_ID"]
CLIENT_ID = os.environ["PBI_CLIENT_ID"]
CLIENT_SECRET = os.environ["PBI_CLIENT_SECRET"]

app = ConfidentialClientApplication(
    CLIENT_ID,
    authority=f"https://login.microsoftonline.com/{TENANT_ID}",
    client_credential=CLIENT_SECRET,
)

token = app.acquire_token_for_client(
    scopes=["https://analysis.windows.net/powerbi/api/.default"]
)
access_token = token["access_token"]
headers = {"Authorization": f"Bearer {access_token}"}
```

### Listar workspaces

```python
resp = requests.get(
    "https://api.powerbi.com/v1.0/myorg/groups",
    headers=headers,
)
workspaces = resp.json()["value"]
for ws in workspaces:
    print(ws["id"], ws["name"])
```

### Triggar refresh de dataset

```python
dataset_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
workspace_id = "yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyy"

resp = requests.post(
    f"https://api.powerbi.com/v1.0/myorg/groups/{workspace_id}/datasets/{dataset_id}/refreshes",
    headers=headers,
)
print(resp.status_code, resp.json())
```

### Push data (enviar dados para dataset)

```python
import json

dataset_id = "..."
workspace_id = "..."  # omitir para "My Workspace"

payload = {
    "rows": [
        {"Data": "2025-01-15", "Produto": "Widget A", "Valor": 1200.50},
        {"Data": "2025-01-16", "Produto": "Widget B", "Valor": 850.00},
    ],
    "tables": [{"name": "Vendas"}],
}

resp = requests.post(
    f"https://api.powerbi.com/v1.0/myorg/groups/{workspace_id}/datasets/{dataset_id}/tables/Vendas/rows",
    headers={**headers, "Content-Type": "application/json"},
    data=json.dumps(payload),
)
print(resp.status_code)
```

### Gerar embed token

```python
# Para embed de relatório
report_id = "..."
embed_payload = {
    "accessLevel": "View",
    "allowSaveAs": False,
}

resp = requests.post(
    f"https://api.powerbi.com/v1.0/myorg/groups/{workspace_id}/reports/{report_id}/GenerateToken",
    headers={**headers, "Content-Type": "application/json"},
    data=json.dumps(embed_payload),
)
embed_token = resp.json()["token"]
```

## Fase 5 — Embed de relatório (JavaScript)

Para mostrar um relatório Power BI numa página web:

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <script src="https://cdn.jsdelivr.net/npm/powerbi-client@2.22.0"></script>
</head>
<body>
  <div id="reportContainer" style="width:100%;height:600px;"></div>
  <script>
    const embedConfig = {
      type: "report",
      embedUrl: "https://app.powerbi.com/reportEmbed?reportId=...",
      accessToken: "<token_from_API>",
      tokenType: models.TokenType.Embed,
      settings: {
        filterPaneEnabled: true,
        navContentPaneEnabled: true,
      },
    };
    const report = powerbi.embed(
      document.getElementById("reportContainer"),
      embedConfig
    );
  </script>
</body>
</html>
```

## Fase 6 — Template .pbit

Um arquivo `.pbit` é um template Power BI em JSON/OpenXML. Pode ser gerado por código
ou aberto como ZIP e editado. Estrutura:

```
template.pbit (ZIP):
  definition.json    -- modelo, measures, DAX
  connections.json   -- data sources
  diagramLayout.json -- layout visual
```

No Linux, use `unzip` para inspecionar:

```bash
unzip -l relatorio.pbit
```

## Alternativas self-hosted

Se o usuário quer BI self-hosted (sem licença Power BI Pro/PPU):

- **Metutabase** (Docker) — open source, dashboards interativos, SQL
- **Superset** (Docker) — Apache, mais customizável
- **Redash** — queries + visualização
- **Grafana** — métricas/temporal (não é BI genérico)

Em Termux puro, nenhuma das opções roda sem `proot-distro`. No PC do usuário com Docker,
Metabase é a recomendada (mais simples).

## Processo recomendado

1. **Entender o objetivo**: o que o usuário quer ver no dashboard? Que granularidade?
2. **Preparar dados**: CSV/Excel/SQL com tipos consistentes, datas ISO, modelo estrela.
3. **Escrever DAX**: medidas separadas (não colunas calculadas quando possível).
4. **Push/embed**: configurar REST API com Azure AD, gerar token, embed.
5. **Testar**: abrir relatório no service.powerbi.com, confirmar dados atualizados.

## Saída esperada

```
Tipo de trabalho: <DAX | M | dados | REST API | embed>
Arquivo(s): <caminhos gerados>
Medidas DAX: <lista>
Queries M: <lista>
API: <endpoints chamados, status>
Próximos passos no Power BI Desktop: <o que o usuário precisa fazer manualmente>
```

## Anti-padrões

- **DAX com FILTER quando CALCULATE simples resolve**: FILTER itera linha a linha — use apenas quando necessário.
- **Time intelligence sem tabela calendário**：medidas YTD/MoM requerem uma tabela calendário marcada como date table.
- **Coluna calculada em vez de medida**: colunas armazenam (gastam memória); medidas calculam sob demanda.
- **Esperar Power BI Desktop no Termux**: não roda. Prepare dados e escreva DAX aqui; o visual fica no Desktop ou service.
- **Credenciais Azure AD no código**: sempre via variáveis de ambiente (`PBI_TENANT_ID`, `PBI_CLIENT_ID`, etc.).
- **Push data sem criar a tabela no dataset**: a tabela e colunas devem existir antes do POST de rows.
- **Sem rate limit**: API tem limites — NÃO martele refresh em loop; verifique status antes de re-llamar.
