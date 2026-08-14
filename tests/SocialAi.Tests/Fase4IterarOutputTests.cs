using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.JsonWebTokens;
using SocialAi.Api.Data;
using SocialAi.Api.Domain;
using SocialAi.Api.Features.Audit;
using SocialAi.Api.Features.Brands;
using SocialAi.Api.Features.Content;
using SocialAi.Api.Features.Ideas;
using SocialAi.Api.Features.Pautas;
using Xunit;

namespace SocialAi.Tests;

/// <summary>
/// FASE 4 / ADR-0006 — iterar sobre o output + promover ideia. Cobre as regras que NÃO
/// dependem de IA nem do AgentsClient: editar texto (conjunto de status), export (ZIP),
/// promover ideia (marca do request). Regenerar (depende do AgentsClient) é coberto pela
/// regra de concorrência/estado, testável sem disparar o pipeline real.
/// </summary>
public class Fase4IterarOutputTests
{
    private static (TestDb db, Guid ws, Guid brand) SeedMarca()
    {
        var db = new TestDb();
        var ws = Guid.NewGuid();
        var brand = Guid.NewGuid();
        db.Current.WorkspaceId = null;
        using var seed = db.NewContext();
        seed.Workspaces.Add(new Workspace { Id = ws, Name = "WS" });
        seed.Brands.Add(new Brand { Id = brand, WorkspaceId = ws, Name = "Marca" });
        seed.SaveChanges();
        return (db, ws, brand);
    }

    private static BrandResolver Resolver(AppDbContext ctx, Guid brand) =>
        new(ctx, new FakeCurrentBrand { BrandId = brand });

    private static ContentController ContentCtrl(TestDb db, AppDbContext ctx, Guid brand) =>
        new(ctx, db.Current, agents: null!, analyzer: null!, brands: Resolver(ctx, brand),
            protector: TestSecrets.Protector(), costs: TestGeneration.Costs(), completion: TestGeneration.Completion(),
            rejectFeedback: new SocialAi.Api.Features.Learning.RejectFeedbackService(ctx));

    private static Guid SeedContent(TestDb db, Guid ws, Guid brand, ContentStatus status, Guid? pautaId = null)
    {
        var id = Guid.NewGuid();
        using var ctx = db.NewContext();
        db.Current.WorkspaceId = null;
        ctx.Contents.Add(new Content
        {
            Id = id, WorkspaceId = ws, BrandId = brand, PautaId = pautaId,
            Type = ContentType.Post, Status = status,
            Caption = "antigo", Cta = "antigo", Hashtags = "#antigo",
            Slides = { new ContentSlide { WorkspaceId = ws, Index = 0, Copy = "copy antiga" } },
        });
        ctx.SaveChanges();
        return id;
    }

    // ── E11.3: editar texto — conjunto de status permitido ───────────────────────
    [Fact]
    public async Task UpdateText_em_Draft_persiste_copy_e_caption()
    {
        var (db, ws, brand) = SeedMarca();
        using (db)
        {
            var id = SeedContent(db, ws, brand, ContentStatus.Draft);
            db.Current.WorkspaceId = ws;
            using (var ctx = db.NewContext())
            {
                var r = await ContentCtrl(db, ctx, brand).UpdateText(id, new ContentTextUpdate(
                    "nova legenda", "novo cta", "#novo", new[] { new SlideTextEdit(0, "copy nova") }));
                Assert.IsType<NoContentResult>(r);
            }
            using var verify = db.NewContext();
            var c = verify.Contents.Include(x => x.Slides).Single(x => x.Id == id);
            Assert.Equal("nova legenda", c.Caption);
            Assert.Equal("copy nova", c.Slides.Single().Copy);
        }
    }

    [Theory]
    [InlineData(ContentStatus.Approved)]
    [InlineData(ContentStatus.Published)]
    [InlineData(ContentStatus.Scheduled)]
    [InlineData(ContentStatus.Generating)]
    public async Task UpdateText_fora_do_par_permitido_da_409(ContentStatus status)
    {
        var (db, ws, brand) = SeedMarca();
        using (db)
        {
            var id = SeedContent(db, ws, brand, status);
            db.Current.WorkspaceId = ws;
            using var ctx = db.NewContext();
            var r = await ContentCtrl(db, ctx, brand).UpdateText(id, new ContentTextUpdate(null, null, null, Array.Empty<SlideTextEdit>()));
            var obj = Assert.IsType<ObjectResult>(r);
            Assert.Equal(409, obj.StatusCode);
        }
    }

    [Fact]
    public async Task UpdateText_de_outra_marca_da_404()
    {
        var (db, ws, brand) = SeedMarca();
        using (db)
        {
            var outraMarca = Guid.NewGuid();
            using (var s = db.NewContext()) { db.Current.WorkspaceId = null; s.Brands.Add(new Brand { Id = outraMarca, WorkspaceId = ws, Name = "B" }); s.SaveChanges(); }
            var id = SeedContent(db, ws, brand, ContentStatus.Draft);
            db.Current.WorkspaceId = ws;
            using var ctx = db.NewContext();
            var r = await ContentCtrl(db, ctx, outraMarca).UpdateText(id, new ContentTextUpdate(null, null, null, Array.Empty<SlideTextEdit>()));
            Assert.IsType<NotFoundResult>(r);
        }
    }

    // ── E11.5: export ZIP (BuildCaption + monta zip sem imagem) ──────────────────
    [Fact]
    public async Task Export_monta_zip_com_legenda_e_omite_slide_sem_imagem()
    {
        var content = new Content
        {
            Caption = "Olha isso", Cta = "Saiba mais", Hashtags = "#a #b",
            Slides = { new ContentSlide { Index = 0, ImageUrl = null } }, // sem imagem → omitido
        };
        var bytes = await ContentExporter.BuildZipAsync(content);
        Assert.NotEmpty(bytes);
        using var ms = new MemoryStream(bytes);
        using var zip = new System.IO.Compression.ZipArchive(ms, System.IO.Compression.ZipArchiveMode.Read);
        Assert.Contains(zip.Entries, e => e.FullName == "legenda.txt");
        Assert.DoesNotContain(zip.Entries, e => e.FullName.StartsWith("slide-"));
    }

    [Fact]
    public void BuildCaption_concatena_caption_cta_hashtags()
    {
        var legenda = ContentExporter.BuildCaption(new Content { Caption = "C", Cta = "Cta", Hashtags = "#h" });
        Assert.Contains("C", legenda);
        Assert.Contains("Cta", legenda);
        Assert.Contains("#h", legenda);
    }

    // ── E4.4: promover ideia ─────────────────────────────────────────────────────
    // FASE 8/C2: o Promote agora grava AuditEntry (idea.promote) — passa AuditService e um
    // ControllerContext com claims (o handler lê ActorId/ActorEmail; sem isso, User dá NRE).
    private static IdeasController IdeasCtrl(TestDb db, AppDbContext ctx, Guid brand)
    {
        var http = new DefaultHttpContext();
        http.User = new ClaimsPrincipal(new ClaimsIdentity(new[]
        {
            new Claim(JwtRegisteredClaimNames.Sub, Guid.NewGuid().ToString()),
            new Claim(JwtRegisteredClaimNames.Email, "admin@x.com"),
        }, "test"));
        return new IdeasController(ctx, db.Current, Resolver(ctx, brand), TestAudit.Service(ctx))
        {
            ControllerContext = new ControllerContext { HttpContext = http },
        };
    }

    [Fact]
    public async Task Promote_cria_pauta_na_marca_do_request_e_marca_promovida()
    {
        var (db, ws, brand) = SeedMarca();
        using (db)
        {
            var ideaId = Guid.NewGuid();
            using (var s = db.NewContext())
            {
                db.Current.WorkspaceId = null;
                s.IdeaCandidates.Add(new IdeaCandidate { Id = ideaId, WorkspaceId = ws, Title = "Ideia X", Rationale = "porque sim", SuggestedType = ContentType.Carousel });
                s.SaveChanges();
            }
            db.Current.WorkspaceId = ws;
            using (var ctx = db.NewContext())
            {
                var r = await IdeasCtrl(db, ctx, brand).Promote(ideaId);
                var ok = Assert.IsType<OkObjectResult>(r.Result);
                var dto = Assert.IsType<PautaDto>(ok.Value);
                Assert.Equal("Ideia X", dto.Title);
                Assert.Equal(ContentType.Carousel, dto.DesiredType);
            }
            using var verify = db.NewContext();
            Assert.True(verify.IdeaCandidates.Single(i => i.Id == ideaId).Promoted);
            var pauta = verify.Pautas.Single(p => p.Title == "Ideia X");
            Assert.Equal(brand, pauta.BrandId); // marca do request, não inferida
        }
    }

    [Fact]
    public async Task Promote_de_ideia_ja_promovida_da_409()
    {
        var (db, ws, brand) = SeedMarca();
        using (db)
        {
            var ideaId = Guid.NewGuid();
            using (var s = db.NewContext())
            {
                db.Current.WorkspaceId = null;
                s.IdeaCandidates.Add(new IdeaCandidate { Id = ideaId, WorkspaceId = ws, Title = "Já", Promoted = true });
                s.SaveChanges();
            }
            db.Current.WorkspaceId = ws;
            using var ctx = db.NewContext();
            var r = await IdeasCtrl(db, ctx, brand).Promote(ideaId);
            var obj = Assert.IsType<ObjectResult>(r.Result);
            Assert.Equal(409, obj.StatusCode);
        }
    }
}
