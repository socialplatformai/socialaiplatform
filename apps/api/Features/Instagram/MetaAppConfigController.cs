using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.JsonWebTokens;
using SocialAi.Api.Data;
using SocialAi.Api.Domain;
using SocialAi.Api.Features.Audit;
using SocialAi.Api.Infrastructure;

namespace SocialAi.Api.Features.Instagram;

public record MetaAppConfigDto(bool Configured, string? AppId);
public record SaveMetaAppConfigRequest(string AppId, string AppSecret);

/// <summary>
/// Cadastro das credenciais do App Meta DENTRO do app (não mais via .env).
/// Persiste cifrado (AES-GCM) na tabela `secrets` por workspace (SecretKind.MetaAppSecret).
/// Restrito a Admin (dono do workspace). O App Secret nunca volta em claro no GET.
/// </summary>
[ApiController]
[Route("api/instagram/app-config")]
[Authorize(Roles = "Admin")]
public class MetaAppConfigController(
    AppDbContext db, SecretProtector protector, ICurrentWorkspace current, AuditService audit) : ControllerBase
{
    private Guid Ws => current.WorkspaceId!.Value;
    private Guid ActorId => User.ActorId();
    private string ActorEmail => User.ActorEmail();
    // Valor cifrado guarda { appId, appSecret } juntos; só o appSecret é sensível,
    // mas cifrar ambos num registro evita uma 2ª linha/coluna (zero migration).
    private record Stored(string AppId, string AppSecret);

    [HttpGet]
    public async Task<ActionResult<MetaAppConfigDto>> Get()
    {
        var secret = await db.Secrets.FirstOrDefaultAsync(s => s.Kind == SecretKind.MetaAppSecret);
        if (secret is null || string.IsNullOrEmpty(secret.EncryptedValue))
            return Ok(new MetaAppConfigDto(false, null));

        var stored = JsonSerializer.Deserialize<Stored>(protector.Decrypt(secret.EncryptedValue));
        // Devolve só o AppId (não-sensível); a presença do secret vira o flag Configured.
        return Ok(new MetaAppConfigDto(true, stored?.AppId));
    }

    [HttpPost]
    public async Task<IActionResult> Save(SaveMetaAppConfigRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.AppId) || string.IsNullOrWhiteSpace(req.AppSecret))
            return Problem("App ID e App Secret são obrigatórios.", statusCode: 400);

        var payload = JsonSerializer.Serialize(new Stored(req.AppId.Trim(), req.AppSecret.Trim()));
        var encrypted = protector.Encrypt(payload);

        var secret = await db.Secrets.FirstOrDefaultAsync(s => s.Kind == SecretKind.MetaAppSecret);
        if (secret is null)
        {
            secret = new Secret { Kind = SecretKind.MetaAppSecret };
            db.Secrets.Add(secret);
        }
        secret.EncryptedValue = encrypted;
        await db.SaveChangesAsync();

        // C2: mudar a config do App Meta é ação sensível (credencial). Auditamos só o AppId
        // (não o secret — invariante 6: segredo nunca em log/trilha).
        await audit.LogAsync(Ws, ActorId, ActorEmail, "meta.app-config.save", req.AppId.Trim());
        return Ok(new MetaAppConfigDto(true, req.AppId.Trim()));
    }

    [HttpDelete]
    public async Task<IActionResult> Delete()
    {
        var secret = await db.Secrets.FirstOrDefaultAsync(s => s.Kind == SecretKind.MetaAppSecret);
        if (secret is null) return NoContent(); // nada mudou → nada a auditar
        db.Secrets.Remove(secret);
        await db.SaveChangesAsync();

        // C2: apagar a credencial Meta desliga a publicação real do workspace — tão sensível
        // quanto salvar (que já é auditado). Sem segredo no Target (invariante 6).
        await audit.LogAsync(Ws, ActorId, ActorEmail, "meta.app-config.delete", "");
        return NoContent();
    }
}
