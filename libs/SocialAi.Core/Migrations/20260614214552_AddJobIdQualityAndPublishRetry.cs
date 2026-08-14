using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SocialAi.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddJobIdQualityAndPublishRetry : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "Attempts",
                table: "PublishLogs",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "NextRetryAt",
                table: "PublishLogs",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "RemoteId",
                table: "PublishLogs",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "JobId",
                table: "Contents",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "QualityScore",
                table: "Contents",
                type: "integer",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Attempts",
                table: "PublishLogs");

            migrationBuilder.DropColumn(
                name: "NextRetryAt",
                table: "PublishLogs");

            migrationBuilder.DropColumn(
                name: "RemoteId",
                table: "PublishLogs");

            migrationBuilder.DropColumn(
                name: "JobId",
                table: "Contents");

            migrationBuilder.DropColumn(
                name: "QualityScore",
                table: "Contents");
        }
    }
}
