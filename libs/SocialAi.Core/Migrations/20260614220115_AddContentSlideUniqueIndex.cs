using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SocialAi.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddContentSlideUniqueIndex : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_ContentSlides_ContentId",
                table: "ContentSlides");

            migrationBuilder.CreateIndex(
                name: "IX_ContentSlides_ContentId_Index",
                table: "ContentSlides",
                columns: new[] { "ContentId", "Index" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_ContentSlides_ContentId_Index",
                table: "ContentSlides");

            migrationBuilder.CreateIndex(
                name: "IX_ContentSlides_ContentId",
                table: "ContentSlides",
                column: "ContentId");
        }
    }
}
