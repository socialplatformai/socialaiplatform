using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SocialAi.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddSpendEntryBrand : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // C (ADR-0008): sub-chave de marca no gasto (painel de uso por marca). NULLABLE —
            // gastos sem marca (loop:idea) permanecem; o isolamento segue por WorkspaceId.
            // FK opcional p/ Brands (sem cascata: apagar marca não apaga histórico de gasto).
            migrationBuilder.AddColumn<Guid>(
                name: "BrandId",
                table: "SpendEntries",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_SpendEntries_BrandId",
                table: "SpendEntries",
                column: "BrandId");

            migrationBuilder.AddForeignKey(
                name: "FK_SpendEntries_Brands_BrandId",
                table: "SpendEntries",
                column: "BrandId",
                principalTable: "Brands",
                principalColumn: "Id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_SpendEntries_Brands_BrandId",
                table: "SpendEntries");

            migrationBuilder.DropIndex(
                name: "IX_SpendEntries_BrandId",
                table: "SpendEntries");

            migrationBuilder.DropColumn(
                name: "BrandId",
                table: "SpendEntries");
        }
    }
}
