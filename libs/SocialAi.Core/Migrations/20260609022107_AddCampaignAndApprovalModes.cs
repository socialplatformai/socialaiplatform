using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SocialAi.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddCampaignAndApprovalModes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "DefaultApprovalMode",
                table: "Workspaces",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "ApprovalModeOverride",
                table: "Contents",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "CampaignId",
                table: "Contents",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "Campaigns",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    ApprovalMode = table.Column<int>(type: "integer", nullable: true),
                    WorkspaceId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Campaigns", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Campaigns_Workspaces_WorkspaceId",
                        column: x => x.WorkspaceId,
                        principalTable: "Workspaces",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Contents_CampaignId",
                table: "Contents",
                column: "CampaignId");

            migrationBuilder.CreateIndex(
                name: "IX_Campaigns_WorkspaceId",
                table: "Campaigns",
                column: "WorkspaceId");

            migrationBuilder.AddForeignKey(
                name: "FK_Contents_Campaigns_CampaignId",
                table: "Contents",
                column: "CampaignId",
                principalTable: "Campaigns",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Contents_Campaigns_CampaignId",
                table: "Contents");

            migrationBuilder.DropTable(
                name: "Campaigns");

            migrationBuilder.DropIndex(
                name: "IX_Contents_CampaignId",
                table: "Contents");

            migrationBuilder.DropColumn(
                name: "DefaultApprovalMode",
                table: "Workspaces");

            migrationBuilder.DropColumn(
                name: "ApprovalModeOverride",
                table: "Contents");

            migrationBuilder.DropColumn(
                name: "CampaignId",
                table: "Contents");
        }
    }
}
