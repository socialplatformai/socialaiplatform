using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SocialAi.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddBrandVisualIdentity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_BrandKits_BrandId",
                table: "BrandKits");

            migrationBuilder.AddColumn<string>(
                name: "AccentColorHex",
                table: "BrandKits",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "BackgroundColorHex",
                table: "BrandKits",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "BodyFont",
                table: "BrandKits",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CopyExamples",
                table: "BrandKits",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "HeadingFont",
                table: "BrandKits",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "LogoUrl",
                table: "BrandKits",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PrimaryColorHex",
                table: "BrandKits",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SecondaryColorHex",
                table: "BrandKits",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TargetAudience",
                table: "BrandKits",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TextColorHex",
                table: "BrandKits",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "VisualPreset",
                table: "BrandKits",
                type: "text",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_BrandKits_BrandId",
                table: "BrandKits",
                column: "BrandId",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_BrandKits_BrandId",
                table: "BrandKits");

            migrationBuilder.DropColumn(
                name: "AccentColorHex",
                table: "BrandKits");

            migrationBuilder.DropColumn(
                name: "BackgroundColorHex",
                table: "BrandKits");

            migrationBuilder.DropColumn(
                name: "BodyFont",
                table: "BrandKits");

            migrationBuilder.DropColumn(
                name: "CopyExamples",
                table: "BrandKits");

            migrationBuilder.DropColumn(
                name: "HeadingFont",
                table: "BrandKits");

            migrationBuilder.DropColumn(
                name: "LogoUrl",
                table: "BrandKits");

            migrationBuilder.DropColumn(
                name: "PrimaryColorHex",
                table: "BrandKits");

            migrationBuilder.DropColumn(
                name: "SecondaryColorHex",
                table: "BrandKits");

            migrationBuilder.DropColumn(
                name: "TargetAudience",
                table: "BrandKits");

            migrationBuilder.DropColumn(
                name: "TextColorHex",
                table: "BrandKits");

            migrationBuilder.DropColumn(
                name: "VisualPreset",
                table: "BrandKits");

            migrationBuilder.CreateIndex(
                name: "IX_BrandKits_BrandId",
                table: "BrandKits",
                column: "BrandId");
        }
    }
}
