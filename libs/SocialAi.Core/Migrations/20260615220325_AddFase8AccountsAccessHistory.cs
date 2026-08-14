using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SocialAi.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddFase8AccountsAccessHistory : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_InstagramAccounts_WorkspaceId",
                table: "InstagramAccounts");

            migrationBuilder.AddColumn<TimeOnly>(
                name: "PublishWindowEnd",
                table: "Workspaces",
                type: "time without time zone",
                nullable: true);

            migrationBuilder.AddColumn<TimeOnly>(
                name: "PublishWindowStart",
                table: "Workspaces",
                type: "time without time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TimeZoneId",
                table: "Workspaces",
                type: "text",
                nullable: false,
                defaultValue: "America/Sao_Paulo");

            migrationBuilder.AddColumn<int>(
                name: "Source",
                table: "PerformanceMetrics",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<Guid>(
                name: "BrandId",
                table: "OAuthStates",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsPrimary",
                table: "InstagramAccounts",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<Guid>(
                name: "TargetInstagramAccountId",
                table: "Contents",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "AuditEntries",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    BrandId = table.Column<Guid>(type: "uuid", nullable: true),
                    ActorUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    ActorEmail = table.Column<string>(type: "text", nullable: false),
                    Action = table.Column<string>(type: "text", nullable: false),
                    Target = table.Column<string>(type: "text", nullable: false),
                    OccurredAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    WorkspaceId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AuditEntries", x => x.Id);
                    table.ForeignKey(
                        name: "FK_AuditEntries_Workspaces_WorkspaceId",
                        column: x => x.WorkspaceId,
                        principalTable: "Workspaces",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "UserInvites",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Token = table.Column<string>(type: "text", nullable: false),
                    Email = table.Column<string>(type: "text", nullable: false),
                    Role = table.Column<int>(type: "integer", nullable: false),
                    ExpiresAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    Consumed = table.Column<bool>(type: "boolean", nullable: false),
                    WorkspaceId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_UserInvites", x => x.Id);
                    table.ForeignKey(
                        name: "FK_UserInvites_Workspaces_WorkspaceId",
                        column: x => x.WorkspaceId,
                        principalTable: "Workspaces",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_InstagramAccounts_WorkspaceId",
                table: "InstagramAccounts",
                column: "WorkspaceId");

            migrationBuilder.CreateIndex(
                name: "IX_Contents_TargetInstagramAccountId",
                table: "Contents",
                column: "TargetInstagramAccountId");

            migrationBuilder.CreateIndex(
                name: "IX_AuditEntries_WorkspaceId_OccurredAt",
                table: "AuditEntries",
                columns: new[] { "WorkspaceId", "OccurredAt" });

            migrationBuilder.CreateIndex(
                name: "IX_UserInvites_Token",
                table: "UserInvites",
                column: "Token",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_UserInvites_WorkspaceId",
                table: "UserInvites",
                column: "WorkspaceId");

            migrationBuilder.AddForeignKey(
                name: "FK_Contents_InstagramAccounts_TargetInstagramAccountId",
                table: "Contents",
                column: "TargetInstagramAccountId",
                principalTable: "InstagramAccounts",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            // ── Migrate (A4): backfill da conta principal por marca ──────────────────
            // Para cada marca, marca IsPrimary=true na conta CONECTADA mais antiga (1 por marca).
            // Idempotente: o NOT EXISTS evita reescrever se a marca já tem uma principal (re-rodar o
            // data step não duplica). Conta mais antiga = menor CreatedAt, desempate por Id.
            migrationBuilder.Sql("""
                UPDATE "InstagramAccounts" a
                SET "IsPrimary" = true
                WHERE a."IsConnected" = true
                  AND a."Id" = (
                    SELECT b."Id" FROM "InstagramAccounts" b
                    WHERE b."BrandId" = a."BrandId" AND b."IsConnected" = true
                    ORDER BY b."CreatedAt" ASC, b."Id" ASC
                    LIMIT 1
                  )
                  AND NOT EXISTS (
                    SELECT 1 FROM "InstagramAccounts" c
                    WHERE c."BrandId" = a."BrandId" AND c."IsPrimary" = true
                  );
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Contents_InstagramAccounts_TargetInstagramAccountId",
                table: "Contents");

            migrationBuilder.DropTable(
                name: "AuditEntries");

            migrationBuilder.DropTable(
                name: "UserInvites");

            migrationBuilder.DropIndex(
                name: "IX_InstagramAccounts_WorkspaceId",
                table: "InstagramAccounts");

            migrationBuilder.DropIndex(
                name: "IX_Contents_TargetInstagramAccountId",
                table: "Contents");

            migrationBuilder.DropColumn(
                name: "PublishWindowEnd",
                table: "Workspaces");

            migrationBuilder.DropColumn(
                name: "PublishWindowStart",
                table: "Workspaces");

            migrationBuilder.DropColumn(
                name: "TimeZoneId",
                table: "Workspaces");

            migrationBuilder.DropColumn(
                name: "Source",
                table: "PerformanceMetrics");

            migrationBuilder.DropColumn(
                name: "BrandId",
                table: "OAuthStates");

            migrationBuilder.DropColumn(
                name: "IsPrimary",
                table: "InstagramAccounts");

            migrationBuilder.DropColumn(
                name: "TargetInstagramAccountId",
                table: "Contents");

            migrationBuilder.CreateIndex(
                name: "IX_InstagramAccounts_WorkspaceId",
                table: "InstagramAccounts",
                column: "WorkspaceId",
                unique: true);
        }
    }
}
