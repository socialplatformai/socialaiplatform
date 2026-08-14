using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SocialAi.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddBrandExpand : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "BrandId",
                table: "Pautas",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "BrandId",
                table: "InstagramAccounts",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "BrandId",
                table: "Contents",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "BrandId",
                table: "Competitors",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "BrandId",
                table: "Campaigns",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "BrandId",
                table: "BrandKits",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "Brands",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    WorkspaceId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Brands", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Brands_Workspaces_WorkspaceId",
                        column: x => x.WorkspaceId,
                        principalTable: "Workspaces",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Pautas_BrandId",
                table: "Pautas",
                column: "BrandId");

            migrationBuilder.CreateIndex(
                name: "IX_InstagramAccounts_BrandId",
                table: "InstagramAccounts",
                column: "BrandId");

            migrationBuilder.CreateIndex(
                name: "IX_Contents_BrandId",
                table: "Contents",
                column: "BrandId");

            migrationBuilder.CreateIndex(
                name: "IX_Competitors_BrandId",
                table: "Competitors",
                column: "BrandId");

            migrationBuilder.CreateIndex(
                name: "IX_Campaigns_BrandId",
                table: "Campaigns",
                column: "BrandId");

            migrationBuilder.CreateIndex(
                name: "IX_BrandKits_BrandId",
                table: "BrandKits",
                column: "BrandId");

            migrationBuilder.CreateIndex(
                name: "IX_Brands_WorkspaceId",
                table: "Brands",
                column: "WorkspaceId");

            migrationBuilder.AddForeignKey(
                name: "FK_BrandKits_Brands_BrandId",
                table: "BrandKits",
                column: "BrandId",
                principalTable: "Brands",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_Campaigns_Brands_BrandId",
                table: "Campaigns",
                column: "BrandId",
                principalTable: "Brands",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_Competitors_Brands_BrandId",
                table: "Competitors",
                column: "BrandId",
                principalTable: "Brands",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_Contents_Brands_BrandId",
                table: "Contents",
                column: "BrandId",
                principalTable: "Brands",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_InstagramAccounts_Brands_BrandId",
                table: "InstagramAccounts",
                column: "BrandId",
                principalTable: "Brands",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_Pautas_Brands_BrandId",
                table: "Pautas",
                column: "BrandId",
                principalTable: "Brands",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            // ── E1 backfill (data-step) — IDEMPOTENTE (DEC-1) ────────────────
            // 1) 1 marca-default por workspace que ainda não tem nenhuma marca.
            //    Nome = Workspace.Name; se vazio/em branco → 'Marca principal'.
            //    Rodar 2x não duplica (NOT EXISTS). gen_random_uuid() é nativo no PG13+.
            migrationBuilder.Sql(@"
                INSERT INTO ""Brands"" (""Id"", ""Name"", ""WorkspaceId"", ""CreatedAt"", ""UpdatedAt"")
                SELECT gen_random_uuid(),
                       CASE WHEN btrim(coalesce(w.""Name"", '')) = '' THEN 'Marca principal' ELSE w.""Name"" END,
                       w.""Id"", now(), now()
                FROM ""Workspaces"" w
                WHERE NOT EXISTS (SELECT 1 FROM ""Brands"" b WHERE b.""WorkspaceId"" = w.""Id"");
            ");

            // 2) Aponta cada entidade de marca para a marca-default do seu workspace,
            //    só onde BrandId ainda é NULL (idempotente; preserva quem já tem marca).
            //    A marca-default é a mais antiga do workspace (determinístico).
            foreach (var tabela in new[] { "BrandKits", "Competitors", "InstagramAccounts", "Pautas", "Contents", "Campaigns" })
            {
                migrationBuilder.Sql($@"
                    UPDATE ""{tabela}"" t
                    SET ""BrandId"" = (
                        SELECT b.""Id"" FROM ""Brands"" b
                        WHERE b.""WorkspaceId"" = t.""WorkspaceId""
                        ORDER BY b.""CreatedAt"" ASC, b.""Id"" ASC
                        LIMIT 1
                    )
                    WHERE t.""BrandId"" IS NULL;
                ");
            }
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_BrandKits_Brands_BrandId",
                table: "BrandKits");

            migrationBuilder.DropForeignKey(
                name: "FK_Campaigns_Brands_BrandId",
                table: "Campaigns");

            migrationBuilder.DropForeignKey(
                name: "FK_Competitors_Brands_BrandId",
                table: "Competitors");

            migrationBuilder.DropForeignKey(
                name: "FK_Contents_Brands_BrandId",
                table: "Contents");

            migrationBuilder.DropForeignKey(
                name: "FK_InstagramAccounts_Brands_BrandId",
                table: "InstagramAccounts");

            migrationBuilder.DropForeignKey(
                name: "FK_Pautas_Brands_BrandId",
                table: "Pautas");

            migrationBuilder.DropTable(
                name: "Brands");

            migrationBuilder.DropIndex(
                name: "IX_Pautas_BrandId",
                table: "Pautas");

            migrationBuilder.DropIndex(
                name: "IX_InstagramAccounts_BrandId",
                table: "InstagramAccounts");

            migrationBuilder.DropIndex(
                name: "IX_Contents_BrandId",
                table: "Contents");

            migrationBuilder.DropIndex(
                name: "IX_Competitors_BrandId",
                table: "Competitors");

            migrationBuilder.DropIndex(
                name: "IX_Campaigns_BrandId",
                table: "Campaigns");

            migrationBuilder.DropIndex(
                name: "IX_BrandKits_BrandId",
                table: "BrandKits");

            migrationBuilder.DropColumn(
                name: "BrandId",
                table: "Pautas");

            migrationBuilder.DropColumn(
                name: "BrandId",
                table: "InstagramAccounts");

            migrationBuilder.DropColumn(
                name: "BrandId",
                table: "Contents");

            migrationBuilder.DropColumn(
                name: "BrandId",
                table: "Competitors");

            migrationBuilder.DropColumn(
                name: "BrandId",
                table: "Campaigns");

            migrationBuilder.DropColumn(
                name: "BrandId",
                table: "BrandKits");
        }
    }
}
