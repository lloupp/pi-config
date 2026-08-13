---
name: excel-charts
description: "Criar e editar planilhas Excel (.xlsx) com openpyxl: dados, fórmulas, formatação, gráficos (barra, pizza, linha, dispersão, área, radar, doughnut), condicional e estilos. Use quando o usuário pedir para gerar, editar ou visualizar planilhas Excel, criar gráficos em Excel ou exportar dados para .xlsx. Para análise de dados em Python, use pandas; para relatórios visuais interativos, use powerbi."
compatibility: Termux/Android (pip install openpyxl), Linux. Python 3.8+. Sem compilação nativa.
---

# Excel Charts

Cria e edita arquivos `.xlsx` com openpyxl — a biblioteca Python pura que funciona em Termux sem
compilação nativa. Todos os exemplos abaixo foram testados em openpyxl 3.1.5.

## Pré-requisito

```bash
pip install openpyxl    # 3.1.x — Python puro, funciona em Termux
```

Se o usuário só precisa ler CSV e converter, `pandas` também serve — mas para **gráficos embutidos**
na planilha, openpyxl é a ferramenta.

## Fase 1 — Criar/abrir a planilha

```python
from openpyxl import Workbook, load_workbook

# Criar nova
wb = Workbook()
ws = wb.active
ws.title = "Vendas"

# Abrir existente (data_only=True para ler valores calculados, não fórmulas)
wb = load_workbook("arquivo.xlsx")
ws = wb["Vendas"]  # ou wb.active
```

## Fase 2 — Escrever dados

```python
# Linhas: append adiciona uma linha por vez
ws.append(["Mês", "Receita", "Custos", "Lucro"])
for row in [("Jan", 12000, 8000, 4000), ("Fev", 15000, 9000, 6000), ("Mar", 18000, 9500, 8500)]:
    ws.append(row)

# Célula individual
ws["A1"] = "Título"
ws["B2"] = "=B3-B4"                # fórmula Excel normal
ws["C2"] = "=SUM(C3:C14)"          # funciona como no Excel

# Múltiplas abas
ws2 = wb.create_sheet("Resumo")
```

## Fase 3 — Formatação

```python
from openpyxl.styles import Font, PatternFill, Border, Side, Alignment

# Cores: padrão ARGB (FF + RGB). Use "FF0000" para vermelho, "00FF00" para verde.
ws["A1"].font = Font(name="Calibri", size=14, bold=True, color="FF0000")
ws["A1"].fill = PatternFill(start_color="FFFF00", end_color="FFFF00", fill_type="solid")

thin = Side(style="thin", color="000000")
ws["A1"].border = Border(left=thin, right=thin, top=thin, bottom=thin)

ws["A1"].alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)

# Formato de números
ws["B2"].number_format = "#,##0.00"        # 1.234,56
ws["B3"].number_format = "0.00%"           # 12,50%
ws["B4"].number_format = "DD/MM/YYYY"       # 15/01/2025
ws["B5"].number_format = "R$ #,##0.00"     # moeda

# Largura de coluna
ws.column_dimensions["A"].width = 20

# Congelar painéis (cabeçalho fixo)
ws.freeze_panes = "A2"

# Mesclar células
ws.merge_cells("D1:E1")
```

## Fase 4 — Gráficos

Todos os gráficos usam `Reference` para apontar para os dados da planilha.

```python
from openpyxl.chart import BarChart, PieChart, LineChart, ScatterChart, AreaChart, RadarChart, DoughnutChart, Reference
from openpyxl.chart.label import DataLabelList
```

### Reference: como apontar para dados

```python
# Dados:
#   A1=Mês  B1=Receita  C1=Custos
#   A2=Jan  B2=12000    C2=8000
#   A3=Fev  B3=15000    C3=9000

# Categorias (rótulos do eixo X) — coluna A, linhas 2-3 (sem cabeçalho)
cats = Reference(ws, min_col=1, min_row=2, max_row=3)

# Valores — coluna B, linhas 1-3 (com cabeçalho, p/ título automático)
values = Reference(ws, min_col=2, min_row=1, max_row=3)
```

### Barra / Coluna

```python
chart = BarChart()
chart.type = "col"            # "col" = vertical (padrão), "bar" = horizontal
chart.grouping = "clustered"  # "clustered" | "stacked" | "percentStacked"
chart.style = 10              # estilo embutido: 1 a 48
chart.title = "Receita por Mês"
chart.y_axis.title = "R$"
chart.x_axis.title = "Mês"
chart.height = 10             # cm
chart.width = 20              # cm

chart.add_data(values, titles_from_data=True)  # titles_from_data usa a linha do cabeçalho como título
chart.set_categories(cats)

ws.add_chart(chart, "E1")     # âncora: célula onde o gráfico aparece
```

### Pizza / Doughnut

```python
chart = PieChart()            # ou DoughnutChart()
chart.add_data(values, titles_from_data=True)
chart.set_categories(cats)
chart.title = "Participação"

# Mostrar valores nos rótulos
chart.dataLabels = DataLabelList()
chart.dataLabels.showPercent = True   # mostra %

ws.add_chart(chart, "E20")
```

### Linha

```python
chart = LineChart()
chart.add_data(values, titles_from_data=True)
chart.set_categories(cats)
chart.title = "Evolução"
chart.height = 10; chart.width = 20

# Marcadores nos pontos
from openpyxl.chart.marker import Marker
chart.series[0].marker = Marker(symbol="circle", size=7)

ws.add_chart(chart, "E40")
```

### Dispersão (Scatter)

```python
chart = ScatterChart()
chart.title = "Correlação"
chart.x_axis.title = "X"
chart.y_axis.title = "Y"

# Scatter exige Series com xvalues e yvalues separados
from openpyxl.chart import Series
xvalues = Reference(ws, min_col=1, min_row=2, max_row=10)
yvalues = Reference(ws, min_col=2, min_row=2, max_row=10)
series = Series(values=yvalues, xvalues=xvalues, title="Dados")
chart.series.append(series)

ws.add_chart(chart, "E60")
```

### Tipos disponíveis

| Classe | Uso |
|---|---|
| `BarChart` | Barras/colunas: comparar valores entre categorias |
| `LineChart` | Linhas: evolução temporal |
| `PieChart` | Pizza: proporção de um todo (≤5 fatias ideal) |
| `DoughnutChart` | Rosca: como pizza, com espaço central |
| `ScatterChart` | Dispersão: correlação entre duas variáveis |
| `AreaChart` | Área: volume/total acumulado ao longo do tempo |
| `RadarChart` | Radar/spider: comparar múltiplas dimensões |

## Fase 5 — Formatação condicional

```python
from openpyxl.formatting.rule import ColorScaleRule, CellIsRule, FormulaRule

# Escala de cor (vermelho→amarelo→verde)
rule = ColorScaleRule(
    start_type="min", start_color="FF0000",
    mid_type="percentile", mid_value=50, mid_color="FFFF00",
    end_type="max", end_color="00FF00",
)
ws.conditional_formatting.add("B2:B100", rule)

# Destacar valores acima de uma meta
ws.conditional_formatting.add("C2:C100", CellIsRule(
    operator="greaterThan", formula=["10000"],
    fill=PatternFill(start_color="00FF00", end_color="00FF00", fill_type="solid"),
))
```

## Fase 6 — Múltiplos gráficos numa planilha

Cada `add_chart` recebe uma célula-âncora diferente. Planeje o layout para não sobrepôr:

```python
ws.add_chart(bar_chart, "E1")      # gráfico 1
ws.add_chart(pie_chart, "E20")     # gráfico 2 (20 linhas abaixo)
ws.add_chart(line_chart, "E40")    # gráfico 3
```

## Fase 7 — Salvar

```python
wb.save("relatorio.xlsx")    # caminho completo em Termux: ~/storage/... ou via SAF
```

Em Termux, para enviar o arquivo ao usuário via `termux-share` ou abrir com `termux-open`:

```bash
termux-open --chooser relatorio.xlsx    # abrir no app de planilha do Android
```

## Fase 8 — Ler dados existentes

```python
wb = load_workbook("dados.xlsx", data_only=True)  # data_only: valores calculados
ws = wb.active

for row in ws.iter_rows(min_row=1, max_row=ws.max_row, max_col=ws.max_column):
    for cell in row:
        print(cell.value)
```

## Processo recomendado

1. **Identifique os dados**: o usuário tem CSV, dados em Python, ou precisa buscar?
2. **Escolha o tipo de gráfico** pela mensagem (comparação = barra, evolução = linha, proporção = pizza).
3. **Escreva os dados** na planilha (append ou célula a célula).
4. **Crie `Reference`** apontando para os dados (lembre: min/max são 1-indexed).
5. **Adicione o gráfico** com `add_data` + `set_categories` + `add_chart`.
6. **Formate** (títulos, cores, rótulos, tamanho).
7. **Salve e teste**: abra em uma planilha (Excel/LibreOffice/Sheets) ou valide com load_workbook.
8. **Entregue**: caminho do arquivo +O que contém + tipo de gráfico.

## Saída esperada

```
Arquivo: <caminho>
Abas: <lista>
Dados: <linhas x colunas>
Gráficos: <tipo:Âncora> por aba
Formatação: <o que foi aplicado>
Caminho: onde o usuário abre
```

## Dicas Termux

- openpyxl é Python puro: `pip install openpyxl` funciona sem build-essential.
- Se o arquivo for grande (>10MB), prefira escrever direto com openpyxl a carregar e reescrever.
- Para abrir no Android: `termux-open --chooser arquivo.xlsx` ou `termux-share -a send arquivo.xlsx`.
- Para acessar arquivos fora do Termux, use `saf` (Storage Access Framework) ou `~/storage/shared/`.

## Anti-padrões

- **Adivinhar índices de Reference**: min_row/min_col são 1-indexed (não 0). Sempre confira com os dados na planilha.
- **Esquecer `titles_from_data=True`**: sem isso, o gráfico não tem título automático de série.
- **Pie com muitas fatias**: pizza idealiza ≤5 categorias. Mais que isso, use barra.
- **Não salvar**: `wb.save()` é explícito — não salva sozinho ao final.
- **Sobrescrever arquivo sem backup**: se editar arquivo existente, faça cópia antes.
- **Fórmula inventada**: só use fórmulas Excel válidas (=SUM, =VLOOKUP, etc.); teste abrindo o arquivo.
