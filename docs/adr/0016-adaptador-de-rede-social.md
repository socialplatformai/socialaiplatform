# ADR-0016 — Abstrair o "adaptador de rede social" (evolução futura)

> Status: **Proposto (não implementar até outra rede entrar no escopo)** · Fase 4 / task 4.5
> Data: 2026-07-01

## Contexto

Hoje toda a esteira de publicação assume **Instagram**: `InstagramGraphPublisher`, `MediaService`
(PNG→JPEG→URL presignada para a Graph API), `MetricsCollectorJob` (endpoint `/insights`), o refresh
de token de 60 dias, e o formato 1080×1350. A fila (`PublishLog` no Postgres), a agenda e o
rate-limit são agnósticos de rede — mas o **publisher** e o **coletor de métricas** não.

Isto é **correto hoje** (um cliente, uma rede). O risco é reescrita: abrir para TikTok/LinkedIn/etc.
sem uma fronteira clara forçaria tocar publisher + métricas + agendamento de uma vez.

## Decisão

**Não implementar agora.** Registrar a fronteira para quando a 2ª rede entrar no escopo:

- Uma interface `ISocialNetworkAdapter` com o contrato mínimo: `PublishAsync(content) → RemoteId`,
  `FetchMetricsAsync(remoteId) → Metric`, `RefreshTokenAsync(account)`, e as restrições de formato
  (aspect ratios, nº de slides, tipos de mídia).
- `PublisherKind` (enum já existente: Mock, InstagramGraph) vira o discriminador de adaptador.
- O robô (`PostingScheduleJob`) e a fila permanecem intactos — só o passo terminal (publicar/coletar)
  resolve o adaptador por conta-alvo.

## Consequências

- **Prós:** evita reescrita quando a 2ª rede chegar; isola o que é específico de Instagram.
- **Contras (por que não agora):** abstrair sobre UMA implementação é adivinhação — o contrato certo
  só aparece com a 2ª rede real. Abstrair cedo custaria complexidade sem retorno (L3: simplicidade
  vence). YAGNI até haver um segundo caso concreto.

## Gatilho de reabertura

Quando um cliente pedir publicação em outra rede que não Instagram. Aí este ADR vira implementação.
