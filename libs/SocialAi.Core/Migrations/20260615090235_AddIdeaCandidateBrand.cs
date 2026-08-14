using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SocialAi.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddIdeaCandidateBrand : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "BrandId",
                table: "IdeaCandidates",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_IdeaCandidates_BrandId",
                table: "IdeaCandidates",
                column: "BrandId");

            migrationBuilder.AddForeignKey(
                name: "FK_IdeaCandidates_Brands_BrandId",
                table: "IdeaCandidates",
                column: "BrandId",
                principalTable: "Brands",
                principalColumn: "Id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_IdeaCandidates_Brands_BrandId",
                table: "IdeaCandidates");

            migrationBuilder.DropIndex(
                name: "IX_IdeaCandidates_BrandId",
                table: "IdeaCandidates");

            migrationBuilder.DropColumn(
                name: "BrandId",
                table: "IdeaCandidates");
        }
    }
}
