using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SocialAi.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddMetricWeightConfig : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "MetricWeightConfigs",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    SavesWeight = table.Column<int>(type: "integer", nullable: false),
                    ReachWeight = table.Column<int>(type: "integer", nullable: false),
                    LikesWeight = table.Column<int>(type: "integer", nullable: false),
                    CommentsWeight = table.Column<int>(type: "integer", nullable: false),
                    WorkspaceId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MetricWeightConfigs", x => x.Id);
                    table.ForeignKey(
                        name: "FK_MetricWeightConfigs_Workspaces_WorkspaceId",
                        column: x => x.WorkspaceId,
                        principalTable: "Workspaces",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_MetricWeightConfigs_WorkspaceId",
                table: "MetricWeightConfigs",
                column: "WorkspaceId",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "MetricWeightConfigs");
        }
    }
}
