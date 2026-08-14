using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SocialAi.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddFrequencyEnum : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // G5 (ADR-0014): Frequency vira enum (int). A coluna text antiga NUNCA foi usada para
            // recorrência real (a feature não era exposta) — qualquer valor textual mapeia para 0
            // (None). O Postgres não casta text→integer automaticamente; o USING explícito faz o
            // mapeamento seguro (texto → None) sem dropar a coluna (EF segue rastreando-a).
            migrationBuilder.Sql(
                "ALTER TABLE \"ScheduledPosts\" " +
                "ALTER COLUMN \"Frequency\" DROP DEFAULT, " +
                "ALTER COLUMN \"Frequency\" TYPE integer USING 0, " +
                "ALTER COLUMN \"Frequency\" SET DEFAULT 0, " +
                "ALTER COLUMN \"Frequency\" SET NOT NULL;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "Frequency",
                table: "ScheduledPosts",
                type: "text",
                nullable: true,
                oldClrType: typeof(int),
                oldType: "integer");
        }
    }
}
