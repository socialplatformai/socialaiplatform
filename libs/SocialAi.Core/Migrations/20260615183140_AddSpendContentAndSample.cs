using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SocialAi.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddSpendContentAndSample : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "ContentId",
                table: "SpendEntries",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsSample",
                table: "Contents",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateIndex(
                name: "IX_SpendEntries_ContentId_Reason",
                table: "SpendEntries",
                columns: new[] { "ContentId", "Reason" },
                unique: true,
                filter: "\"ContentId\" IS NOT NULL");

            migrationBuilder.AddForeignKey(
                name: "FK_SpendEntries_Contents_ContentId",
                table: "SpendEntries",
                column: "ContentId",
                principalTable: "Contents",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_SpendEntries_Contents_ContentId",
                table: "SpendEntries");

            migrationBuilder.DropIndex(
                name: "IX_SpendEntries_ContentId_Reason",
                table: "SpendEntries");

            migrationBuilder.DropColumn(
                name: "ContentId",
                table: "SpendEntries");

            migrationBuilder.DropColumn(
                name: "IsSample",
                table: "Contents");
        }
    }
}
