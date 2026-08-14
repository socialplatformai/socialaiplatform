using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SocialAi.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddSpendTelemetry : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<decimal>(
                name: "AmountUsd",
                table: "SpendEntries",
                type: "numeric(12,4)",
                precision: 12,
                scale: 4,
                nullable: false,
                oldClrType: typeof(decimal),
                oldType: "numeric(12,2)",
                oldPrecision: 12,
                oldScale: 2);

            migrationBuilder.AddColumn<int>(
                name: "ImageCount",
                table: "SpendEntries",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "JobId",
                table: "SpendEntries",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Model",
                table: "SpendEntries",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Provider",
                table: "SpendEntries",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "TextInputTokens",
                table: "SpendEntries",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "TextOutputTokens",
                table: "SpendEntries",
                type: "integer",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_SpendEntries_JobId",
                table: "SpendEntries",
                column: "JobId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_SpendEntries_JobId",
                table: "SpendEntries");

            migrationBuilder.DropColumn(
                name: "ImageCount",
                table: "SpendEntries");

            migrationBuilder.DropColumn(
                name: "JobId",
                table: "SpendEntries");

            migrationBuilder.DropColumn(
                name: "Model",
                table: "SpendEntries");

            migrationBuilder.DropColumn(
                name: "Provider",
                table: "SpendEntries");

            migrationBuilder.DropColumn(
                name: "TextInputTokens",
                table: "SpendEntries");

            migrationBuilder.DropColumn(
                name: "TextOutputTokens",
                table: "SpendEntries");

            migrationBuilder.AlterColumn<decimal>(
                name: "AmountUsd",
                table: "SpendEntries",
                type: "numeric(12,2)",
                precision: 12,
                scale: 2,
                nullable: false,
                oldClrType: typeof(decimal),
                oldType: "numeric(12,4)",
                oldPrecision: 12,
                oldScale: 4);
        }
    }
}
