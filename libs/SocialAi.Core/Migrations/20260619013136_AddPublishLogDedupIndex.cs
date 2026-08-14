using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SocialAi.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddPublishLogDedupIndex : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_PublishLogs_ScheduledPostId",
                table: "PublishLogs");

            migrationBuilder.CreateIndex(
                name: "IX_PublishLogs_ScheduledPostId",
                table: "PublishLogs",
                column: "ScheduledPostId",
                unique: true,
                filter: "\"Result\" IN (0, 1)");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_PublishLogs_ScheduledPostId",
                table: "PublishLogs");

            migrationBuilder.CreateIndex(
                name: "IX_PublishLogs_ScheduledPostId",
                table: "PublishLogs",
                column: "ScheduledPostId");
        }
    }
}
