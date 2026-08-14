using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using SocialAi.Api.Features.Content;
using Xunit;

namespace SocialAi.Tests;

/// <summary>
/// Imagem de slide (MinIO) — duplicata no layer: a imagem do slide é DUPLICADA dentro do LayersJson
/// (<c>background.value</c> e o elemento <c>role:background/image</c> em <c>elements[].content</c>) —
/// o pipeline emite 2 cópias e o LayersJson é persistido verbatim (ADR-0014). O DTO já reescrevia
/// <c>slide.ImageUrl</c> → URL do proxy, mas a cópia DENTRO do layer continuava base64 inline (medido:
/// ~5,4MB num carrossel mesmo com o store ligado). <see cref="MinioImageStore.RewriteLayersImages"/>
/// reescreve essa cópia p/ a MESMA URL do proxy. Estes testes travam a invariante: NENHUM blob de
/// imagem (base64/minio:) sai no DTO quando o store está presente — sem perder a composição nem o texto.
/// </summary>
public class LayersImageRewriteTests
{
    private const string Proxy = "https://api.exemplo.com/api/content/abc/slides/0/image";
    private const string Base64 = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD";
    private const string MinioRef = "minio:slides/ws/content/0.jpg";

    // Placeholders em vez de raw-string interpolada (evita colisão {{ }} com chaves do JSON).
    private static JsonElement Parse(string json) =>
        JsonDocument.Parse(json.Replace("@B64@", Base64).Replace("@MINIO@", MinioRef)).RootElement.Clone();

    [Fact]
    public void Imagem_em_background_value_vira_url_do_proxy()
    {
        var layers = Parse("""{"background":{"type":"image","value":"@B64@"}}""");
        var outp = MinioImageStore.RewriteLayersImages(layers, Proxy);
        Assert.NotNull(outp);
        Assert.Equal(Proxy, outp!.Value.GetProperty("background").GetProperty("value").GetString());
    }

    [Fact]
    public void Imagem_em_elemento_role_background_vira_url_do_proxy()
    {
        var layers = Parse("""
        {"elements":[
            {"type":"text","role":"headline","content":"Como crescer no Instagram"},
            {"type":"image","role":"background","content":"@B64@"}
        ]}
        """);
        var outp = MinioImageStore.RewriteLayersImages(layers, Proxy);
        Assert.NotNull(outp);
        var els = outp!.Value.GetProperty("elements");
        // Texto preservado verbatim (não é imagem).
        Assert.Equal("Como crescer no Instagram", els[0].GetProperty("content").GetString());
        // Imagem reescrita p/ a URL do proxy.
        Assert.Equal(Proxy, els[1].GetProperty("content").GetString());
    }

    [Fact]
    public void Ref_minio_no_layer_tambem_vira_url_do_proxy()
    {
        var layers = Parse("""{"elements":[{"type":"image","role":"image","content":"@MINIO@"}]}""");
        var outp = MinioImageStore.RewriteLayersImages(layers, Proxy);
        Assert.Equal(Proxy, outp!.Value.GetProperty("elements")[0].GetProperty("content").GetString());
    }

    [Fact]
    public void NENHUM_blob_de_imagem_sobra_no_json_serializado()
    {
        // A invariante: o JSON final não carrega base64 nem ref minio: (só a URL leve do proxy).
        var layers = Parse("""
        {"background":{"type":"image","value":"@B64@"},
         "elements":[
            {"type":"text","role":"body","content":"texto qualquer"},
            {"type":"image","role":"background","content":"@B64@"}
        ]}
        """);
        var outp = MinioImageStore.RewriteLayersImages(layers, Proxy);
        var raw = outp!.Value.GetRawText();
        Assert.DoesNotContain("data:image", raw);
        Assert.DoesNotContain("minio:", raw);
        Assert.Contains(Proxy, raw);
        Assert.Contains("texto qualquer", raw); // o texto não foi tocado
    }

    [Fact]
    public void Texto_puro_em_elements_nunca_e_reescrito()
    {
        var layers = Parse("""
        {"elements":[
            {"type":"text","role":"headline","content":"Headline"},
            {"type":"text","role":"cta","content":"Arrasta pra ver"}
        ]}
        """);
        var outp = MinioImageStore.RewriteLayersImages(layers, Proxy);
        var els = outp!.Value.GetProperty("elements");
        Assert.Equal("Headline", els[0].GetProperty("content").GetString());
        Assert.Equal("Arrasta pra ver", els[1].GetProperty("content").GetString());
        Assert.DoesNotContain(Proxy, outp!.Value.GetRawText()); // nada de imagem → nada reescrito
    }

    [Fact]
    public void Layers_nulo_devolve_nulo_sem_quebrar()
    {
        Assert.Null(MinioImageStore.RewriteLayersImages(null, Proxy));
    }

    [Fact]
    public void Background_solido_gradiente_nao_e_imagem_passa_intacto()
    {
        // value de cor/gradiente NÃO começa com data:image nem minio: → não toca.
        var layers = Parse("""{"background":{"type":"solid","value":"#1A1A1A"}}""");
        var outp = MinioImageStore.RewriteLayersImages(layers, Proxy);
        Assert.Equal("#1A1A1A", outp!.Value.GetProperty("background").GetProperty("value").GetString());
    }

    [Fact]
    public void IsHeavyImage_distingue_imagem_de_texto()
    {
        Assert.True(MinioImageStore.IsHeavyImage("data:image/jpeg;base64,AAA"));
        Assert.True(MinioImageStore.IsHeavyImage("minio:slides/x.jpg"));
        Assert.False(MinioImageStore.IsHeavyImage("Headline qualquer"));
        Assert.False(MinioImageStore.IsHeavyImage("#FFD44A"));
        Assert.False(MinioImageStore.IsHeavyImage(null));
        // http já é URL (proxy ou legado) — idempotente: não re-reescreve, não é "heavy".
        Assert.False(MinioImageStore.IsHeavyImage("https://api/x/slides/0/image"));
    }

    // ── Auth da imagem servida ao browser: o token vai na QUERY (não há header em <img>/CSS) ──
    [Fact]
    public void ProxyUrlOf_anexa_access_token_na_query_quando_presente()
    {
        var store = NovoStore(apiBase: "http://localhost:5080");
        var id = Guid.Parse("11111111-1111-1111-1111-111111111111");
        var url = store.ProxyUrlOf(id, 2, "tok.en-123");
        Assert.StartsWith("http://localhost:5080/api/content/11111111-1111-1111-1111-111111111111/slides/2/image", url);
        Assert.Contains("?access_token=tok.en-123", url);
    }

    [Fact]
    public void ProxyUrlOf_sem_token_nao_poe_query()
    {
        var store = NovoStore(apiBase: "http://localhost:5080");
        var url = store.ProxyUrlOf(Guid.Empty, 0, null);
        Assert.DoesNotContain("access_token", url);
        Assert.DoesNotContain("?", url);
    }

    [Fact]
    public void ProxyUrlOf_token_com_caracteres_especiais_e_escapado()
    {
        var store = NovoStore(apiBase: "http://localhost:5080");
        var url = store.ProxyUrlOf(Guid.Empty, 0, "a b+c/d=e");
        // Espaço/+///= não podem quebrar a query — Uri.EscapeDataString.
        Assert.DoesNotContain(" ", url);
        Assert.Contains("access_token=a%20b%2Bc%2Fd%3De", url);
    }

    private static MinioImageStore NovoStore(string apiBase)
    {
        var cfg = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Minio:Endpoint"] = "localhost:9000",
                ["Api:PublicBaseUrl"] = apiBase,
            }).Build();
        return new MinioImageStore(cfg, NullLogger<MinioImageStore>.Instance);
    }
}
