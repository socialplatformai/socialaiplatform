using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SocialAi.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddGlobalUniqueEmail : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // D2: o antigo único tenant-scoped (WorkspaceId, Email) vira não-único.
            migrationBuilder.DropIndex(
                name: "IX_Users_WorkspaceId_Email",
                table: "Users");

            migrationBuilder.CreateIndex(
                name: "IX_Users_WorkspaceId_Email",
                table: "Users",
                columns: new[] { "WorkspaceId", "Email" });

            // Normaliza e-mails existentes (Trim + lower) — pré-requisito do índice.
            migrationBuilder.Sql(@"UPDATE ""Users"" SET ""Email"" = lower(btrim(""Email""));");

            // Unicidade GLOBAL e case-insensitive via índice FUNCIONAL em lower("Email").
            // O EF não expressa índice funcional no modelo, por isso é criado por SQL.
            // Havendo duplicata legada, a criação falha com erro claro (deduplicar antes).
            migrationBuilder.Sql(
                @"CREATE UNIQUE INDEX ix_users_email_global_unique ON ""Users"" (lower(""Email""));");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"DROP INDEX IF EXISTS ix_users_email_global_unique;");

            migrationBuilder.DropIndex(
                name: "IX_Users_WorkspaceId_Email",
                table: "Users");

            migrationBuilder.CreateIndex(
                name: "IX_Users_WorkspaceId_Email",
                table: "Users",
                columns: new[] { "WorkspaceId", "Email" },
                unique: true);
        }
    }
}
