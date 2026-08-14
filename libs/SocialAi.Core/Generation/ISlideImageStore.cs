namespace SocialAi.Api.Generation;

/// <summary>
/// Imagem de slide (MinIO): a imagem de slide viajava como base64 inline (~10MB/peça) no
/// DTO de GET /content/{id}, deixando a edição PESADA. Esta abstração materializa a imagem num
/// store de objetos (MinIO) NO MOMENTO da geração e devolve uma URL curta — então `ContentSlide.ImageUrl`
/// passa a ser uma URL (não um blob), e o DTO fica leve. Sem migration: a coluna já é `string?`,
/// só muda o CONTEÚDO (URL no lugar do data-url).
///
/// Fronteira: Core NÃO conhece MinIO. O <c>GenerationCompletionService</c> depende só desta
/// interface fina; cada host injeta sua implementação:
///   • worker → reusa o <c>MediaService</c> (PNG→JPEG→MinIO→presigned URL) que o publish já usa;
///   • api    → uma impl equivalente sobre a lib Minio.
///
/// Degraded-mode (first-class neste projeto): SEM store registrado (dev sem MinIO) o
/// <c>GenerationCompletionService</c> recebe <c>null</c> e mantém o base64 — honesto, sem regressão.
/// O sacrifício nomeado: em dev sem MinIO o DTO continua pesado; em prod (com MinIO) fica leve.
/// </summary>
public interface ISlideImageStore
{
    /// <summary>
    /// Materializa <paramref name="source"/> (data-url base64 OU já-uma-referência) no store e devolve
    /// uma REFERÊNCIA ESTÁVEL <c>minio:{key}</c> — NÃO uma URL presigned (que expiraria; o editor
    /// reabre a peça depois). Cada consumidor resolve a referência na sua borda:
    ///   • a API reescreve <c>minio:{key}</c> → URL ABSOLUTA do proxy (GET /content/{id}/slides/{i}/image),
    ///     que presigna fresco a cada request (sem TTL morto);
    ///   • o publish/export resolvem <c>minio:{key}</c> → bytes/presigned direto no MinIO.
    /// Contrato de tolerância:
    ///   • source nulo/vazio → null (slide sem imagem);
    ///   • source já é <c>minio:</c> ou http(s) → verbatim (idempotente; não re-sobe);
    ///   • falha de upload → devolve o <paramref name="source"/> original (degrada honesto: a peça
    ///     ainda renderiza com o base64; nunca perde a imagem por causa do store).
    /// <paramref name="objectKey"/> é a chave estável do objeto (ex.: "{ws}/{contentId}/{index}").
    /// </summary>
    Task<string?> StoreAsync(string? source, string objectKey, CancellationToken ct = default);
}
