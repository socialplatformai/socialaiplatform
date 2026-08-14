using SocialAi.Api.Infrastructure;
using Xunit;

namespace SocialAi.Tests;

/// <summary>
/// Freio-mestre do robô (LoopSwitch). A precedência é a salvaguarda: o banco (SystemSetting, ligável
/// por TELA) VENCE o env; sem linha no banco, cai no env; sem nada, default FALSE (opt-in explícito).
/// Um valor corrompido no banco não pode "ligar" o robô por acidente.
/// </summary>
public class LoopSwitchTests
{
    [Fact]
    public async Task Default_sem_banco_e_sem_env_e_false()
    {
        using var db = new TestDb();
        using var ctx = db.NewContext();
        var enabled = await LoopSwitch.IsEnabledAsync(ctx, TestGeneration.Config());
        Assert.False(enabled);
    }

    [Fact]
    public async Task Env_true_sem_banco_liga()
    {
        using var db = new TestDb();
        using var ctx = db.NewContext();
        var cfg = TestGeneration.Config(new Dictionary<string, string?> { ["Loop:Enabled"] = "true" });
        Assert.True(await LoopSwitch.IsEnabledAsync(ctx, cfg));
    }

    [Fact]
    public async Task Banco_vence_o_env()
    {
        using var db = new TestDb();
        // Banco diz FALSE; env diz TRUE — o banco (controlável por tela) vence.
        using (var w = db.NewContext())
        {
            await LoopSwitch.SetAsync(w, false);
            await w.SaveChangesAsync();
        }
        using var ctx = db.NewContext();
        var cfg = TestGeneration.Config(new Dictionary<string, string?> { ["Loop:Enabled"] = "true" });
        Assert.False(await LoopSwitch.IsEnabledAsync(ctx, cfg));
    }

    [Fact]
    public async Task Banco_true_liga_mesmo_sem_env()
    {
        using var db = new TestDb();
        using (var w = db.NewContext())
        {
            await LoopSwitch.SetAsync(w, true);
            await w.SaveChangesAsync();
        }
        using var ctx = db.NewContext();
        Assert.True(await LoopSwitch.IsEnabledAsync(ctx, TestGeneration.Config()));
    }

    [Fact]
    public async Task Set_faz_upsert_idempotente()
    {
        using var db = new TestDb();
        // Liga, depois desliga — a 2ª escrita atualiza a MESMA linha (não duplica a PK "Loop:Enabled").
        using (var w = db.NewContext()) { await LoopSwitch.SetAsync(w, true); await w.SaveChangesAsync(); }
        using (var w = db.NewContext()) { await LoopSwitch.SetAsync(w, false); await w.SaveChangesAsync(); }
        using var ctx = db.NewContext();
        Assert.False(await LoopSwitch.IsEnabledAsync(ctx, TestGeneration.Config()));
        Assert.Single(ctx.SystemSettings);
    }

    [Fact]
    public async Task Valor_corrompido_no_banco_cai_no_fallback_env()
    {
        using var db = new TestDb();
        using (var w = db.NewContext())
        {
            w.SystemSettings.Add(new SocialAi.Api.Domain.SystemSetting { Key = LoopSwitch.Key, Value = "sim-por-favor" });
            await w.SaveChangesAsync();
        }
        using var ctx = db.NewContext();
        // Valor não-booleano → ignora o banco e usa o env (aqui ausente → false). Nunca liga por lixo.
        Assert.False(await LoopSwitch.IsEnabledAsync(ctx, TestGeneration.Config()));
        var cfgOn = TestGeneration.Config(new Dictionary<string, string?> { ["Loop:Enabled"] = "true" });
        Assert.True(await LoopSwitch.IsEnabledAsync(ctx, cfgOn));
    }
}
