# Entrega ao cliente — o que é cada arquivo

Pasta com os documentos que vão para o cliente.

| Arquivo | O que é |
|---------|---------|
| `MATRIZ-ESCOPO-ENTREGA.md` | **Matriz de aceite** — cada exigência do escopo contratado × o que foi entregue, com evidência no código (arquivo:linha) e veredito honesto. **É o documento de validação da entrega.** |
| `manual-cliente.html` | **Manual do operador** — passo a passo de uso (criar conta → marca → Instagram → pautas → gerar → aprovar → agendar → histórico → configurações + FAQ). PT-BR, à prova de leigo. |
| `Manual-do-Cliente-...pdf` | Versão PDF do manual (impressão do HTML acima). |
| `assets/` | CSS de impressão (`apex-pdf.css`) usado pelo manual. |

## Regenerar os PDFs (a partir do HTML)

Os PDFs são a impressão dos HTMLs via Chrome headless. Com o Chrome/Edge instalado:

```bash
# Manual do cliente
chrome --headless --disable-gpu --print-to-pdf="Manual-do-Cliente-Social-AI-Platform.pdf" \
  --no-pdf-header-footer "manual-cliente.html"
```

> No Windows, use o caminho do executável (ex.: `"C:\Program Files\Google\Chrome\Application\chrome.exe"`)
> ou `msedge` no lugar de `chrome`. Abra o HTML no navegador e confira antes de imprimir.

## O manual cobre (jornada completa)

Visão geral · primeiro acesso · marca · Instagram · pautas · gerar · aprovar/agendar · painel inicial ·
**histórico/desempenho/ideias** · **configurações (membros, fuso, uso e custo, IA, auditoria)** · dúvidas.

## Fonte da verdade técnica (para a equipe, não para o cliente)

- Como instalar/configurar: `docs/DEPLOYMENT.md` (arquitetura, credenciais, modos, variáveis).
- Estado por capacidade (entregue/parcial/roadmap) e o que falta: `docs/sot/09-roadmap.md`.
- Arquitetura e fluxos: `docs/sot/` · Decisões por feature: `docs/adr/`.
