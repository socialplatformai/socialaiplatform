using SocialAi.Api.Domain;
using SocialAi.Worker.Jobs;
using Xunit;

namespace SocialAi.Tests;

/// <summary>
/// G5 (ADR-0014) — recorrência de publicação. Fecha a lacuna de teste do PublishSchedulerJob
/// (antes sem teste). Prova as duas peças puras do reagendamento:
///  - NextOccurrence: o próximo instante é derivado em UTC por intervalo de calendário (Daily/
///    Weekly/Monthly); None → null (não reagenda);
///  - CloneContentForRecurrence: o clone copia os campos publicáveis + slides, nasce Approved e
///    IsSample=false, herda WorkspaceId/BrandId (isolamento), e NÃO arrasta o histórico de geração
///    (job/aprovação/agendamento) do original.
/// O fio que liga as duas (DispatchDuePosts → CreateNextOccurrenceAsync) é privado e usa scope DI;
/// estas peças puras são o coração testável, e o BuildAgentRequest/Schedule cobrem o contrato HTTP.
/// </summary>
public class RecorrenciaTests
{
    private static readonly DateTimeOffset Base =
        new(2026, 6, 15, 9, 0, 0, TimeSpan.Zero); // UTC fixo (determinístico)

    [Fact]
    public void NextOccurrence_none_nao_reagenda()
    {
        Assert.Null(PublishSchedulerJob.NextOccurrence(Base, Frequency.None));
    }

    [Fact]
    public void NextOccurrence_daily_soma_um_dia()
    {
        Assert.Equal(Base.AddDays(1), PublishSchedulerJob.NextOccurrence(Base, Frequency.Daily));
    }

    [Fact]
    public void NextOccurrence_weekly_soma_sete_dias()
    {
        Assert.Equal(Base.AddDays(7), PublishSchedulerJob.NextOccurrence(Base, Frequency.Weekly));
    }

    [Fact]
    public void NextOccurrence_monthly_soma_um_mes_respeitando_fim_de_mes()
    {
        // 31/jan + 1 mês = 28/fev (AddMonths satura no fim do mês — sem 31/fev inválido).
        var jan31 = new DateTimeOffset(2026, 1, 31, 12, 0, 0, TimeSpan.Zero);
        Assert.Equal(new DateTimeOffset(2026, 2, 28, 12, 0, 0, TimeSpan.Zero),
            PublishSchedulerJob.NextOccurrence(jan31, Frequency.Monthly));
    }

    [Fact]
    public void Clone_copia_campos_publicaveis_e_nasce_aprovado_nao_sample()
    {
        var ws = Guid.NewGuid();
        var brand = Guid.NewGuid();
        var account = Guid.NewGuid();
        var original = new Content
        {
            WorkspaceId = ws,
            BrandId = brand,
            PautaId = Guid.NewGuid(),
            TargetInstagramAccountId = account,
            Type = ContentType.Carousel,
            Status = ContentStatus.Published,  // o original já publicou
            JobId = "job-da-geracao-original", // NÃO deve ser arrastado
            QualityScore = 88,
            Caption = "Legenda original",
            Cta = "Saiba mais",
            Hashtags = "#a #b",
            IsSample = true,                   // mesmo um sample não contamina o clone
            Slides =
            {
                new ContentSlide { WorkspaceId = ws, Index = 1, Copy = "S1", ImageUrl = "u1" },
                new ContentSlide { WorkspaceId = ws, Index = 0, Copy = "S0", ImageUrl = "u0" },
            },
        };

        var clone = PublishSchedulerJob.CloneContentForRecurrence(original);

        // Identidade nova, mas marca/conta/tipo/textos preservados.
        Assert.NotEqual(original.Id, clone.Id);
        Assert.Equal(ws, clone.WorkspaceId);
        Assert.Equal(brand, clone.BrandId);
        Assert.Equal(account, clone.TargetInstagramAccountId);
        Assert.Equal(ContentType.Carousel, clone.Type);
        Assert.Equal("Legenda original", clone.Caption);
        Assert.Equal("#a #b", clone.Hashtags);
        Assert.Equal(88, clone.QualityScore);

        // A série herda a aprovação e NÃO é sample; o histórico da geração não vem junto.
        Assert.Equal(ContentStatus.Approved, clone.Status);
        Assert.False(clone.IsSample);
        Assert.Null(clone.JobId);

        // Slides copiados (em ordem de Index) com identidade nova.
        Assert.Equal(2, clone.Slides.Count);
        var ordered = clone.Slides.OrderBy(s => s.Index).ToList();
        Assert.Equal(0, ordered[0].Index);
        Assert.Equal("S0", ordered[0].Copy);
        Assert.Equal(1, ordered[1].Index);
        Assert.Equal(ws, ordered[0].WorkspaceId); // isolamento herdado
        Assert.All(clone.Slides, s => Assert.NotEqual(original.Id, s.ContentId));
    }

    [Fact]
    public void Clone_persistido_pelo_worker_nao_vaza_para_outro_workspace()
    {
        using var db = new TestDb();
        var wsA = Guid.NewGuid();
        var wsB = Guid.NewGuid();
        var brandA = Guid.NewGuid();

        // Worker é sistêmico: WorkspaceId=null (filtro de leitura passa; isolamento via WorkspaceId
        // explícito no carimbo do clone). Simula CreateNextOccurrenceAsync persistindo o clone.
        db.Current.WorkspaceId = null;
        using (var ctx = db.NewContext())
        {
            ctx.Workspaces.Add(new Workspace { Id = wsA, Name = "A" });
            ctx.Workspaces.Add(new Workspace { Id = wsB, Name = "B" });
            ctx.Brands.Add(new Brand { Id = brandA, WorkspaceId = wsA, Name = "MA" });
            var original = new Content
            {
                WorkspaceId = wsA, BrandId = brandA, Type = ContentType.Post,
                Status = ContentStatus.Published, Caption = "Original da A",
                Slides = { new ContentSlide { WorkspaceId = wsA, Index = 0, Copy = "S0" } },
            };
            ctx.Contents.Add(original);
            ctx.SaveChanges();

            var clone = PublishSchedulerJob.CloneContentForRecurrence(original);
            ctx.Contents.Add(clone);
            ctx.ScheduledPosts.Add(new ScheduledPost
            {
                WorkspaceId = wsA, Content = clone,
                ScheduledFor = Base.AddDays(7), Frequency = Frequency.Weekly,
            });
            ctx.SaveChanges();
        }

        // No contexto do workspace B, o filtro de leitura NÃO mostra o clone da A.
        db.Current.WorkspaceId = wsB;
        using (var ctx = db.NewContext())
        {
            Assert.Empty(ctx.Contents.Where(c => c.Caption == "Original da A"));
            Assert.Empty(ctx.ScheduledPosts.ToList());
        }

        // No contexto da A, o clone aparece (2 contents: original + clone) e a recorrência foi criada.
        db.Current.WorkspaceId = wsA;
        using (var ctx = db.NewContext())
        {
            Assert.Equal(2, ctx.Contents.Count());
            var post = Assert.Single(ctx.ScheduledPosts.ToList());
            Assert.Equal(Frequency.Weekly, post.Frequency);
            Assert.False(post.Dispatched);
        }
    }
}
