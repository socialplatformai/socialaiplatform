using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SocialAi.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddWorkspaceAutomationFlags : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Fase 2 (task 2.1): default 70 no BANCO (não 0) — linhas existentes herdam o mesmo
            // threshold de "passed" do pipeline. 0 auto-aprovaria tudo (permissivo demais); alinhado
            // com o inicializador C# (Workspace.AutoApprovalThreshold = 70).
            migrationBuilder.AddColumn<int>(
                name: "AutoApprovalThreshold",
                table: "Workspaces",
                type: "integer",
                nullable: false,
                defaultValue: 70);

            migrationBuilder.AddColumn<bool>(
                name: "AutoPostEnabled",
                table: "Workspaces",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<int>(
                name: "CreativeStrategy",
                table: "Workspaces",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "PostingScheduleDays",
                table: "Workspaces",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "PostingScheduleTimes",
                table: "Workspaces",
                type: "text",
                nullable: false,
                defaultValue: "");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "AutoApprovalThreshold",
                table: "Workspaces");

            migrationBuilder.DropColumn(
                name: "AutoPostEnabled",
                table: "Workspaces");

            migrationBuilder.DropColumn(
                name: "CreativeStrategy",
                table: "Workspaces");

            migrationBuilder.DropColumn(
                name: "PostingScheduleDays",
                table: "Workspaces");

            migrationBuilder.DropColumn(
                name: "PostingScheduleTimes",
                table: "Workspaces");
        }
    }
}
