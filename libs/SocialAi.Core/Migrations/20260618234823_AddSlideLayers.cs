using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SocialAi.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddSlideLayers : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // FASE 1 (ADR-0014): DROP + ADD (não RenameColumn). Embora as duas colunas sejam text?,
            // o conteúdo de RenderHtml é ~1 MB de HTML/base64 inútil (B2) — um rename o preservaria
            // mascarado como LayersJson (JSON inválido). Dropar descarta o lixo; a nova coluna nasce
            // vazia (NULL) e só recebe JSON de camadas válido das gerações da F1 em diante.
            migrationBuilder.DropColumn(
                name: "RenderHtml",
                table: "ContentSlides");

            migrationBuilder.AddColumn<string>(
                name: "LayersJson",
                table: "ContentSlides",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "LayersJson",
                table: "ContentSlides");

            migrationBuilder.AddColumn<string>(
                name: "RenderHtml",
                table: "ContentSlides",
                type: "text",
                nullable: true);
        }
    }
}
