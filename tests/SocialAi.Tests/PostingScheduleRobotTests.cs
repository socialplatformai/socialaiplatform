using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using SocialAi.Api.Domain;
using SocialAi.Worker.Jobs;
using Xunit;

namespace SocialAi.Tests;

/// <summary>
/// Fase 2 (tasks 2.3–2.6) — o ROBÔ. Prova as peças PURAS (o fio DI é privado, coberto pelo build):
///  - PostingSchedule: parse tolerante do CSV, "é hora?" com tolerância, próximo slot livre anti-colisão;
///  - ThemeSelection.Choose: prioridade + anti-repetição;
///  - PostingScheduleJob.DecideApproval: gate de auto-aprovação sob threshold.
/// </summary>
public class PostingScheduleRobotTests
{
    // ── PostingSchedule.ParseDays / ParseTimes ────────────────────────────────────────────────
    [Fact]
    public void ParseDays_ignora_tokens_invalidos_e_fora_de_faixa()
    {
        var days = PostingSchedule.ParseDays("1, 3 ,5, 9, x, -1");
        Assert.Equal(new HashSet<int> { 1, 3, 5 }, days); // 9/-1 fora de [0,6]; "x" não-numérico
    }

    [Fact]
    public void ParseDays_vazio_conjunto_vazio()
    {
        Assert.Empty(PostingSchedule.ParseDays(""));
        Assert.Empty(PostingSchedule.ParseDays(null));
    }

    [Fact]
    public void ParseTimes_ordena_dedup_e_ignora_malformado()
    {
        var times = PostingSchedule.ParseTimes("18:00, 09:00, 09:00, zz");
        Assert.Equal(new[] { new TimeOnly(9, 0), new TimeOnly(18, 0) }, times);
    }

    // ── PostingSchedule.IsDuePostingTime ──────────────────────────────────────────────────────
    [Fact]
    public void IsDue_true_no_dia_e_dentro_da_tolerancia()
    {
        // Quarta (DayOfWeek=3), 09:30 local; agenda Seg/Qua/Sex 09:00. 30min <= 60min tolerância.
        var now = new DateTime(2026, 7, 1, 9, 30, 0); // 2026-07-01 é quarta
        Assert.Equal(DayOfWeek.Wednesday, now.DayOfWeek);
        Assert.True(PostingSchedule.IsDuePostingTime(now, "1,3,5", "09:00,18:00"));
    }

    [Fact]
    public void IsDue_false_fora_do_dia()
    {
        var terca = new DateTime(2026, 6, 30, 9, 0, 0); // terça
        Assert.Equal(DayOfWeek.Tuesday, terca.DayOfWeek);
        Assert.False(PostingSchedule.IsDuePostingTime(terca, "1,3,5", "09:00"));
    }

    [Fact]
    public void IsDue_false_antes_do_horario_ou_muito_depois()
    {
        var quarta = new DateTime(2026, 7, 1, 8, 59, 0); // 1min ANTES → não conta (delta negativo)
        Assert.False(PostingSchedule.IsDuePostingTime(quarta, "3", "09:00"));
        var tarde = new DateTime(2026, 7, 1, 10, 30, 0); // 90min depois > 60 tolerância
        Assert.False(PostingSchedule.IsDuePostingTime(tarde, "3", "09:00"));
    }

    [Fact]
    public void IsDue_false_agenda_vazia()
    {
        var quarta = new DateTime(2026, 7, 1, 9, 0, 0);
        Assert.False(PostingSchedule.IsDuePostingTime(quarta, "", ""));
    }

    // ── PostingSchedule.CountSlotsPassedToday (catch-up por contagem) ─────────────────────────
    [Fact]
    public void CountSlots_conta_apenas_horarios_ja_passados_no_dia()
    {
        var quarta1730 = new DateTime(2026, 7, 1, 17, 30, 0); // quarta
        Assert.Equal(DayOfWeek.Wednesday, quarta1730.DayOfWeek);
        // 09:00 e 17:30 já passaram (inclusive no minuto exato); 18:00 ainda não.
        Assert.Equal(2, PostingSchedule.CountSlotsPassedToday(quarta1730, "3", "09:00,17:30,18:00"));
    }

    [Fact]
    public void CountSlots_zero_fora_do_dia_ou_antes_do_primeiro_horario()
    {
        var terca = new DateTime(2026, 6, 30, 23, 59, 0); // terça — dia fora da agenda
        Assert.Equal(0, PostingSchedule.CountSlotsPassedToday(terca, "3", "09:00"));
        var quartaCedo = new DateTime(2026, 7, 1, 8, 59, 0); // antes do primeiro slot
        Assert.Equal(0, PostingSchedule.CountSlotsPassedToday(quartaCedo, "3", "09:00"));
    }

    [Fact]
    public void CountSlots_recupera_slot_perdido_horas_depois()
    {
        // O cenário do bug real (2026-07-29): slot 17:30, serviço dormiu, tick só às 19:00 —
        // a tolerância de 60min perdia o slot (IsDuePostingTime=false); o catch-up NÃO perde.
        var quarta19h = new DateTime(2026, 7, 1, 19, 0, 0);
        Assert.False(PostingSchedule.IsDuePostingTime(quarta19h, "3", "17:30"));
        Assert.Equal(1, PostingSchedule.CountSlotsPassedToday(quarta19h, "3", "17:30"));
    }

    [Fact]
    public void CountSlots_zero_agenda_vazia()
    {
        var quarta = new DateTime(2026, 7, 1, 12, 0, 0);
        Assert.Equal(0, PostingSchedule.CountSlotsPassedToday(quarta, "", ""));
        Assert.Equal(0, PostingSchedule.CountSlotsPassedToday(quarta, null, null));
    }

    // ── PostingSchedule.NextFreeSlot (anti-colisão, task 2.6) ──────────────────────────────────
    [Fact]
    public void NextFreeSlot_pula_slot_ocupado()
    {
        var from = new DateTime(2026, 7, 1, 10, 0, 0); // quarta 10h (após o slot das 09h)
        // Agenda Seg/Qua/Sex 09:00 e 18:00. 10h já passou o 09h de hoje → 18h de hoje é o candidato.
        // Ocupa 18h de hoje → deve pular para o próximo dia da agenda (sexta 09h).
        var occupied = new List<DateTime> { new(2026, 7, 1, 18, 0, 0) };
        var slot = PostingSchedule.NextFreeSlot(from, "1,3,5", "09:00,18:00", occupied);
        Assert.NotNull(slot);
        Assert.Equal(new DateTime(2026, 7, 3, 9, 0, 0), slot); // sexta 09:00
    }

    [Fact]
    public void NextFreeSlot_null_sem_agenda()
    {
        var from = new DateTime(2026, 7, 1, 10, 0, 0);
        Assert.Null(PostingSchedule.NextFreeSlot(from, "", "", new List<DateTime>()));
    }

    [Fact]
    public void NextFreeSlot_primeiro_slot_futuro_quando_livre()
    {
        var from = new DateTime(2026, 7, 1, 8, 0, 0); // quarta 08h, antes do 09h
        var slot = PostingSchedule.NextFreeSlot(from, "3", "09:00,18:00", new List<DateTime>());
        Assert.Equal(new DateTime(2026, 7, 1, 9, 0, 0), slot);
    }

    // ── ThemeSelection.Choose (anti-repetição, task 2.4) ──────────────────────────────────────
    private static Pauta P(string title, Priority prio, DateTimeOffset created) =>
        new() { Id = Guid.NewGuid(), Title = title, Priority = prio, CreatedAt = created, BrandId = Guid.NewGuid() };

    [Fact]
    public void Choose_prefere_tema_novo_de_maior_prioridade()
    {
        var t0 = new DateTimeOffset(2026, 6, 1, 0, 0, 0, TimeSpan.Zero);
        var pautas = new[]
        {
            P("Promo antiga", Priority.High, t0),        // repetida recente
            P("Lançamento", Priority.Medium, t0.AddDays(1)), // nova, prioridade menor
            P("Bastidores", Priority.High, t0.AddDays(2)),   // nova, prioridade alta
        };
        var recent = new HashSet<string> { ThemeSelection.Normalize("Promo antiga") };
        var sel = ThemeSelection.Choose(pautas, recent);
        Assert.NotNull(sel);
        Assert.True(sel!.IsFreshTheme);
        Assert.Equal("Bastidores", sel.Pauta.Title); // nova + High vence a nova Medium
    }

    [Fact]
    public void Choose_cai_em_repeticao_quando_tudo_recente_marcando_nao_fresh()
    {
        var t0 = new DateTimeOffset(2026, 6, 1, 0, 0, 0, TimeSpan.Zero);
        var pautas = new[] { P("A", Priority.Low, t0), P("B", Priority.High, t0.AddDays(1)) };
        var recent = new HashSet<string> { "a", "b" };
        var sel = ThemeSelection.Choose(pautas, recent);
        Assert.NotNull(sel);
        Assert.False(sel!.IsFreshTheme);
        Assert.Equal("B", sel.Pauta.Title); // maior prioridade mesmo repetida (não trava)
    }

    [Fact]
    public void Choose_null_sem_candidatos()
    {
        Assert.Null(ThemeSelection.Choose(Array.Empty<Pauta>(), new HashSet<string>()));
    }

    // ── PostingScheduleJob.DecideApproval (gate, task 2.5) ────────────────────────────────────
    [Fact]
    public void DecideApproval_score_null_nao_auto_aprova()
    {
        var (approved, reason) = PostingScheduleJob.DecideApproval(null, 70);
        Assert.False(approved);
        Assert.Contains("não avaliado", reason);
    }

    [Fact]
    public void DecideApproval_score_acima_do_threshold_aprova()
    {
        var (approved, _) = PostingScheduleJob.DecideApproval(85, 70);
        Assert.True(approved);
    }

    [Fact]
    public void DecideApproval_score_abaixo_do_threshold_revisao_humana()
    {
        var (approved, reason) = PostingScheduleJob.DecideApproval(60, 70);
        Assert.False(approved);
        Assert.Contains("revisão humana", reason);
    }

    // ── FASE B (COLHER): gate + agenda da arte que o robô gerou (task 2.3, elo worker→agents) ──────
    // Prova que, dado um Content FromAutonomousLoop já concluído (Draft com QualityScore real), a fase
    // de colheita aplica o gate: nota alta → auto-aprova + agenda; nota baixa → revisão humana.
    private static PostingScheduleJob NewJob() =>
        new(services: null!, cfg: TestGeneration.Config(), logger: NullLogger<PostingScheduleJob>.Instance);

    private static (Guid ws, Guid brand) SeedWs(TestDb db, int approvalThreshold, string days = "1,3,5", string times = "09:00,18:00")
    {
        var ws = Guid.NewGuid();
        var brand = Guid.NewGuid();
        using var seed = db.NewContext();
        seed.Workspaces.Add(new Workspace
        {
            Id = ws, Name = "WS", AutoPostEnabled = true, AutoApprovalThreshold = approvalThreshold,
            PostingScheduleDays = days, PostingScheduleTimes = times, TimeZoneId = "UTC",
        });
        seed.Brands.Add(new Brand { Id = brand, WorkspaceId = ws, Name = "Marca" });
        seed.Budgets.Add(new Budget { WorkspaceId = ws, MonthlyCapUsd = 100m, AutonomousLoopEnabled = true });
        seed.SaveChanges();
        return (ws, brand);
    }

    private static Content SeedGeneratedContent(TestDb db, Guid ws, Guid brand, int? score)
    {
        using var ctx = db.NewContext();
        var content = new Content
        {
            WorkspaceId = ws, BrandId = brand, Type = ContentType.Post,
            Status = ContentStatus.Draft, FromAutonomousLoop = true, QualityScore = score,
            Caption = "arte gerada",
        };
        ctx.Contents.Add(content);
        ctx.SaveChanges();
        return content;
    }

    [Fact]
    public async Task Harvest_nota_alta_auto_aprova_e_agenda()
    {
        using var db = new TestDb();
        db.Current.WorkspaceId = null; // worker sem filtro de tenant
        var (ws, brand) = SeedWs(db, approvalThreshold: 70);
        var content = SeedGeneratedContent(db, ws, brand, score: 85); // >= threshold

        await using var ctx = db.NewContext();
        var wsEntity = await ctx.Workspaces.FirstAsync(w => w.Id == ws);
        // Quarta 09:00 UTC — bate a agenda (Seg/Qua/Sex 09:00), então há slot livre.
        var nowLocal = new DateTimeOffset(2026, 7, 1, 9, 0, 0, TimeSpan.Zero);
        var changed = await NewJob().HarvestGeneratedAsync(ctx, wsEntity, nowLocal, default);
        await ctx.SaveChangesAsync();

        Assert.True(changed);
        var saved = await ctx.Contents.Include(c => c.Approval).Include(c => c.ScheduledPost)
            .FirstAsync(c => c.Id == content.Id);
        Assert.Equal(ContentStatus.Scheduled, saved.Status);
        Assert.NotNull(saved.Approval);
        Assert.Equal("robot", saved.Approval!.Reviewer);
        Assert.NotNull(saved.ScheduledPost); // agendado no slot livre
    }

    [Fact]
    public async Task Harvest_nota_baixa_vai_para_revisao_humana_sem_agendar()
    {
        using var db = new TestDb();
        db.Current.WorkspaceId = null;
        var (ws, brand) = SeedWs(db, approvalThreshold: 70);
        var content = SeedGeneratedContent(db, ws, brand, score: 40); // < threshold

        await using var ctx = db.NewContext();
        var wsEntity = await ctx.Workspaces.FirstAsync(w => w.Id == ws);
        var nowLocal = new DateTimeOffset(2026, 7, 1, 9, 0, 0, TimeSpan.Zero);
        var changed = await NewJob().HarvestGeneratedAsync(ctx, wsEntity, nowLocal, default);
        await ctx.SaveChangesAsync();

        Assert.True(changed);
        var saved = await ctx.Contents.Include(c => c.Approval).Include(c => c.ScheduledPost)
            .FirstAsync(c => c.Id == content.Id);
        Assert.Equal(ContentStatus.PendingApproval, saved.Status);
        Assert.Null(saved.Approval);       // não auto-aprova
        Assert.Null(saved.ScheduledPost);  // não agenda
    }

    [Fact]
    public async Task Harvest_libera_pauta_presa_quando_a_geracao_falhou()
    {
        // Geração do robô falhou (Content Failed) → a pauta ficou InProgress. A colheita deve devolvê-la
        // a Backlog para o robô re-tentar (senão fica presa para sempre).
        using var db = new TestDb();
        db.Current.WorkspaceId = null;
        var (ws, brand) = SeedWs(db, approvalThreshold: 70);
        Guid pautaId;
        using (var ctx = db.NewContext())
        {
            var pauta = new Pauta
            {
                WorkspaceId = ws, BrandId = brand, Title = "Tema", Status = PautaStatus.InProgress,
            };
            ctx.Pautas.Add(pauta);
            ctx.Contents.Add(new Content
            {
                WorkspaceId = ws, BrandId = brand, PautaId = pauta.Id, Type = ContentType.Post,
                Status = ContentStatus.Failed, FromAutonomousLoop = true,
            });
            ctx.SaveChanges();
            pautaId = pauta.Id;
        }

        await using var ctx2 = db.NewContext();
        var wsEntity = await ctx2.Workspaces.FirstAsync(w => w.Id == ws);
        await NewJob().HarvestGeneratedAsync(ctx2, wsEntity, new DateTimeOffset(2026, 7, 1, 9, 0, 0, TimeSpan.Zero), default);
        await ctx2.SaveChangesAsync();

        var pautaSaved = await ctx2.Pautas.FirstAsync(p => p.Id == pautaId);
        Assert.Equal(PautaStatus.Backlog, pautaSaved.Status); // liberada para re-tentar
    }

    [Fact]
    public async Task Harvest_score_null_nao_agenda_deixa_revisao()
    {
        // Arte ainda sem nota (reaper não avaliou / geração degradada) → conservador: revisão humana.
        using var db = new TestDb();
        db.Current.WorkspaceId = null;
        var (ws, brand) = SeedWs(db, approvalThreshold: 70);
        var content = SeedGeneratedContent(db, ws, brand, score: null);

        await using var ctx = db.NewContext();
        var wsEntity = await ctx.Workspaces.FirstAsync(w => w.Id == ws);
        var nowLocal = new DateTimeOffset(2026, 7, 1, 9, 0, 0, TimeSpan.Zero);
        await NewJob().HarvestGeneratedAsync(ctx, wsEntity, nowLocal, default);
        await ctx.SaveChangesAsync();

        var saved = await ctx.Contents.Include(c => c.ScheduledPost).FirstAsync(c => c.Id == content.Id);
        Assert.Equal(ContentStatus.PendingApproval, saved.Status);
        Assert.Null(saved.ScheduledPost);
    }
}
