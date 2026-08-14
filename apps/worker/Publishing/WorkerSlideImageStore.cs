using SocialAi.Api.Generation;

namespace SocialAi.Worker.Publishing;

/// <summary>
/// Adapter do worker p/ <see cref="ISlideImageStore"/> sobre o <see cref="MediaService"/> existente.
/// Usado pelo caminho de reconciliação (GeneratingReaperJob) que completa gerações órfãs via o mesmo
/// GenerationCompletionService da API — então a materialização da imagem (base64 → minio:{key}) é
/// idêntica nos dois caminhos. Sem config de MinIO a impl nem é registrada (o completion recebe null).
/// </summary>
public sealed class WorkerSlideImageStore(MediaService media, ILogger<WorkerSlideImageStore> logger) : ISlideImageStore
{
    public async Task<string?> StoreAsync(string? source, string objectKey, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(source)) return null;
        if (source.StartsWith(MediaService.RefScheme) || source.StartsWith("http")) return source;
        try
        {
            return await media.StoreStableAsync(source, objectKey, ct);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Falha ao materializar slide no MinIO (worker); mantendo base64.");
            return source; // degrada honesto: nunca perde a imagem
        }
    }
}
