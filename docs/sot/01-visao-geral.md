# 01 — Visão Geral

> Responde "o que é isto, para quem serve e qual o valor". Leitura de 5 minutos antes de
> mergulhar na [arquitetura](02-arquitetura.md). Termos técnicos linkam para o
> [glossário](08-glossario.md).

---

## O que é

A **Social AI Platform** é uma plataforma *self-hosted* (instalada na infraestrutura do próprio
cliente) que **gera, aprova, agenda e publica conteúdo de Instagram de forma autônoma**, usando um
pipeline de 6 [agentes](08-glossario.md#agente-de-ia) de Inteligência Artificial. Um
[loop autônomo](08-glossario.md#loop-autônomo) opcional aprende com o desempenho das publicações e
inventa novas [pautas](08-glossario.md#pauta) quando a fila editorial esvazia.

Em uma frase:

> Plataforma [multi-tenant](08-glossario.md#multi-tenant-multilocatário) que transforma um briefing
> editorial ([pauta](08-glossario.md#pauta)) em um post de Instagram pronto, com aprovação humana no
> meio do caminho e publicação real ou simulada no fim.

## Para quem

| Público | Como usa |
|---------|----------|
| **Operador de marketing** (usuário final) | Cria pautas, dispara a geração, aprova/rejeita conteúdo, agenda e acompanha o calendário pela interface web. |
| **Administrador do workspace** | Tudo do operador + conecta o Instagram, configura modos de aprovação e credenciais do app Meta, liga o loop autônomo. |
| **Operador de infraestrutura / DevOps** | Sobe a plataforma com Docker Compose, configura segredos, faz backup, faz o *flip* de publicação simulada para real. Ver [04 — Instalação](04-instalacao.md) e [05 — Operação](05-operacao.md). |
| **Engenheiro / cliente técnico** | Audita o código e a arquitetura. Ver [02 — Arquitetura](02-arquitetura.md) e [07 — Segurança](07-seguranca.md). |

## O valor

- **Produção de conteúdo em escala** sem terceirizar a redação: o pipeline escreve em
  português do Brasil, no tom da marca, e monta o layout visual.
- **Controle humano preservado**: por padrão, nada vai ao ar sem aprovação. O
  [gate de moderação](03-fluxos.md) é um invariante do sistema.
- **Isolamento por cliente**: cada [workspace](08-glossario.md#workspace-espaço-de-trabalho) é
  estanque; um cliente nunca vê os dados de outro.
- **Funciona desde o primeiro minuto**: mesmo sem as chaves de IA ou do Instagram, a plataforma
  sobe e é navegável — o chamado [modo degradado](08-glossario.md#modo-degradado).

## O que entra e o que sai

```
        ENTRA                         A PLATAFORMA FAZ                      SAI
  ┌──────────────────┐      ┌─────────────────────────────────┐    ┌──────────────────┐
  │ Marca (tom, cor, │      │ 1. Gera (6 agentes de IA)       │    │ Post pronto:     │
  │ logo, exemplos)  │ ───▶ │ 2. Pede aprovação humana        │ ──▶│ slides + texto + │
  │ Pauta (briefing) │      │ 3. Agenda                       │    │ legenda + nota   │
  │                  │      │ 4. Publica (real ou simulado)   │    │ de qualidade     │
  └──────────────────┘      │ 5. Coleta métricas → aprende    │    └──────────────────┘
                            └─────────────────────────────────┘
```
*Figura: visão de altíssimo nível do que a plataforma recebe, faz e devolve. O detalhe de cada etapa
está em [03 — Fluxos](03-fluxos.md).*

## Estado em uma olhada

Esta documentação descreve o sistema **como ele é hoje**, não como se planeja que seja. A separação
entre o que está entregue, o que opera em modo degradado e o que é roadmap é mantida com rigor (ver
[09 — Roadmap](09-roadmap.md)).

| Capacidade | Estado |
|------------|--------|
| Cadastro, login, multi-tenancy, CRUD de marca e pautas | ✅ Pleno |
| Geração de conteúdo (pipeline de 6 agentes) | ✅ Pleno (requer chave de IA) |
| Aprovação, agendamento, calendário | ✅ Pleno |
| Publicação **simulada** ([mock](08-glossario.md#mock-modo-mock)) | ✅ Pleno (ponta a ponta, sem Meta) |
| Publicação **real** ([graph](08-glossario.md#graph-modo-graph)) | ✅ Pronta — depende só de configuração + [App Review](08-glossario.md#app-review-meta) da Meta |
| Conexão com Instagram ([OAuth](08-glossario.md#oauth)) | ✅ Pleno |
| [Loop autônomo](08-glossario.md#loop-autônomo) | ✅ Entregue, **desligado por padrão** (opt-in) |
| [Modo degradado](08-glossario.md#modo-degradado) (sem chaves) | ✅ Estado de primeira classe |
| Promoção de [IdeaCandidate](08-glossario.md#ideacandidate-candidato-a-ideia) pela interface | ✅ Pleno — tela `/ideas` + endpoint de promoção |
| Coleta de métricas **reais** do Instagram | ✅ Pleno — parse de insights da Graph API implementado |

> **Nota:** a *geração* de ideias do loop autônomo é hoje um rascunho de texto fixo (ainda não usa IA
> nem histórico de performance). O fluxo de promoção a pauta está completo; é a qualidade da ideia
> gerada que evolui no [roadmap](09-roadmap.md).

## Por onde seguir

1. **Entender a estrutura** → [02 — Arquitetura](02-arquitetura.md)
2. **Ver as jornadas ponta a ponta** → [03 — Fluxos](03-fluxos.md)
3. **Subir do zero** → [04 — Instalação](04-instalacao.md)
4. **Operar no dia a dia** → [05 — Operação](05-operacao.md)
5. **Consultar fatos (variáveis, rotas, enums)** → [06 — Referência](06-referencia.md)

---

*Esta `sot/` é a fonte canônica do estado do sistema.*
