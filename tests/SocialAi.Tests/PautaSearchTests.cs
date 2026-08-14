using SocialAi.Api.Features.Pautas;
using Xunit;

namespace SocialAi.Tests;

/// <summary>
/// E12.1 (ADR-0007) — busca de pautas por título.
///
/// O TestDb roda sobre SQLite, que NÃO tem a função ILike do Postgres; portanto NÃO
/// dá para exercitar a query real aqui (seria "teatro de teste"). O que importa para a
/// correção da busca é o ESCAPE dos curingas do LIKE no termo: %/_/\ têm que virar
/// LITERAIS, não wildcards. Essa lógica vive em PautaController.EscapeLike — função
/// pura, extraída justamente para ser testável sem Postgres. O caminho ILike real
/// (montagem do termo "%...%" + escape char "\\") é coberto pelo smoke manual de marcas.
/// </summary>
public class PautaSearchTests
{
    [Fact]
    public void EscapeLike_termo_simples_e_inalterado()
    {
        Assert.Equal("engajamento", PautaController.EscapeLike("engajamento"));
    }

    [Fact]
    public void EscapeLike_percent_vira_literal()
    {
        // O '%' digitado pelo usuário tem que ser escapado para NÃO virar wildcard.
        // Com o termo "%50\\%%" o ILike trata o '%' do meio como literal.
        Assert.Equal("50\\%", PautaController.EscapeLike("50%"));
    }

    [Fact]
    public void EscapeLike_underscore_vira_literal()
    {
        Assert.Equal("a\\_b", PautaController.EscapeLike("a_b"));
    }

    [Fact]
    public void EscapeLike_backslash_escapado_antes_dos_curingas()
    {
        // Ordem load-bearing: '\' é escapado PRIMEIRO; senão o '\' que escapa '%' seria
        // ele mesmo re-escapado, corrompendo o padrão. Entrada "\%" → "\\\%".
        Assert.Equal("\\\\\\%", PautaController.EscapeLike("\\%"));
    }

    [Fact]
    public void EscapeLike_combina_todos_os_curingas()
    {
        // "100%_\" → cada metacaractere precedido de '\': 100 \% \_ \\
        Assert.Equal("100\\%\\_\\\\", PautaController.EscapeLike("100%_\\"));
    }
}
