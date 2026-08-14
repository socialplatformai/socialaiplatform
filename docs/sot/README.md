# Documentação SoT — Social AI Platform

> **Hub de navegação.** Este diretório (`docs/sot/`) é a **fonte de verdade (Source of Truth)
> formal** do projeto: documentação modular, em português do Brasil, organizada pelo framework
> [Diátaxis](08-glossario.md#diátaxis). Cada arquivo trata de **um assunto** e declara seu quadrante
> no cabeçalho.

## Como navegar

A documentação é dividida pelos quatro quadrantes do Diátaxis — escolha pela sua intenção:

| Sua intenção | Quadrante | Vá para |
|--------------|-----------|---------|
| **Entender** o que é e por quê | Explicação | [01 — Visão geral](01-visao-geral.md), [02 — Arquitetura](02-arquitetura.md), [03 — Fluxos](03-fluxos.md), [07 — Segurança](07-seguranca.md), [09 — Roadmap](09-roadmap.md) |
| **Aprender** subindo do zero | Tutorial | [04 — Instalação](04-instalacao.md) |
| **Resolver** uma tarefa pontual | How-to | [05 — Operação](05-operacao.md) |
| **Consultar** um fato | Referência | [06 — Referência](06-referencia.md), [08 — Glossário](08-glossario.md) |

## Mapa dos arquivos

```
docs/sot/
├── README.md            → este hub
├── 01-visao-geral.md    → (Explicação) o que é, para quem, valor, estado em uma olhada
├── 02-arquitetura.md    → (Explicação) topologia, serviços, fluxo de dados (Mermaid + ASCII)
├── 03-fluxos.md         → (Explicação) jornadas ponta a ponta (sequence diagrams)
├── 04-instalacao.md     → (Tutorial)   subir do zero, passo a passo, com verificação
├── 05-operacao.md       → (How-to)     conectar IG, flip mock→graph, backup, segredos, logs
├── 06-referencia.md     → (Referência) env, endpoints, enums, jobs, migrations
├── 07-seguranca.md      → (Explicação) ameaças, multi-tenancy, segredos, trade-offs
├── 08-glossario.md      → (Referência) todo termo e sigla definido
└── 09-roadmap.md        → (Explicação) entregue vs degradado vs roadmap
```

## Ordem de leitura sugerida (primeira vez)

1. [01 — Visão geral](01-visao-geral.md) — o panorama em 5 minutos.
2. [02 — Arquitetura](02-arquitetura.md) — como as peças se encaixam.
3. [03 — Fluxos](03-fluxos.md) — como o sistema se comporta de ponta a ponta.
4. [04 — Instalação](04-instalacao.md) — coloque para rodar.
5. Depois, use [05 — Operação](05-operacao.md) e [06 — Referência](06-referencia.md) como consulta.

## Princípios desta documentação

- **Fidelidade ao código:** toda afirmação sobre o sistema vem dos arquivos reais do repositório
  (citados pelo caminho). O que não pôde ser confirmado está marcado como "a confirmar".
- **Honestidade de estado:** o que está entregue, o que opera em
  [modo degradado](08-glossario.md#modo-degradado) e o que é roadmap são distinguidos com rigor (ver
  [09 — Roadmap](09-roadmap.md)). Roadmap nunca é apresentado como entregue.
- **Um assunto por arquivo**, com links em vez de duplicação.
- **Sem siglas indefinidas e sem termos vagos**: todo termo é definido no
  [glossário](08-glossario.md).

## Documentos relacionados (fora deste diretório)

| Documento | Papel |
|-----------|-------|
| `../../ARCHITECTURE.md` | Arquitetura voltada ao desenvolvedor (as partes que cruzam arquivos). |
| `../DEPLOYMENT.md` | Guia de operações/credenciais (complementar ao [05 — Operação](05-operacao.md)). |
| `../../README.md` | Visão rápida do repositório e quickstart. |

> ⚠️ **Não use** `../entrega-cliente/` (PDFs/HTML) como fonte: foi gerado antes do endurecimento da
> fundação e está desatualizado. Deve ser **regenerado** a partir desta documentação (ver
> [09 — Roadmap](09-roadmap.md) §4).

---

*Fonte de verdade formal do projeto. Mantenha sincronizada com o código a cada mudança estrutural.*
