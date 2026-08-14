using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SocialAi.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddContentReasoningJson : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // AI-native (teatro c/ justificativa): raciocínio dos agentes serializado em JSON.
            // Nullable, aditivo — gerações antigas ficam null (a UI omite o painel "Raciocínio da IA").
            migrationBuilder.AddColumn<string>(
                name: "ReasoningJson",
                table: "Contents",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ReasoningJson",
                table: "Contents");
        }
    }
}
