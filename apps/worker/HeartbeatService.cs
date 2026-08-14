namespace SocialAi.Worker;

/// <summary>
/// BackgroundService base — prova que o worker sobe e o loop de fundo roda.
/// Complementado pelos jobs reais (PublishScheduler/Publish/Metrics/Loop/Reaper).
/// </summary>
public sealed class HeartbeatService(ILogger<HeartbeatService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        logger.LogInformation("Worker iniciado. Jobs de fundo (PeriodicTimer) em execução.");
        while (!stoppingToken.IsCancellationRequested)
        {
            logger.LogDebug("worker heartbeat {Time:O}", DateTimeOffset.UtcNow);
            try
            {
                await Task.Delay(TimeSpan.FromSeconds(60), stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
        logger.LogInformation("Worker encerrando.");
    }
}
