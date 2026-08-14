using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SocialAi.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddAiConfigUsageAndTemplates : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "ForcedTemplateId",
                table: "Pautas",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "BrandLibraryItems",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    BrandId = table.Column<Guid>(type: "uuid", nullable: false),
                    Kind = table.Column<int>(type: "integer", nullable: false),
                    Value = table.Column<string>(type: "text", nullable: false),
                    Label = table.Column<string>(type: "text", nullable: true),
                    WorkspaceId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BrandLibraryItems", x => x.Id);
                    table.ForeignKey(
                        name: "FK_BrandLibraryItems_Brands_BrandId",
                        column: x => x.BrandId,
                        principalTable: "Brands",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_BrandLibraryItems_Workspaces_WorkspaceId",
                        column: x => x.WorkspaceId,
                        principalTable: "Workspaces",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "Templates",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Key = table.Column<string>(type: "text", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    Description = table.Column<string>(type: "text", nullable: true),
                    SpecJson = table.Column<string>(type: "text", nullable: false),
                    BuiltIn = table.Column<bool>(type: "boolean", nullable: false),
                    WorkspaceId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Templates", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Templates_Workspaces_WorkspaceId",
                        column: x => x.WorkspaceId,
                        principalTable: "Workspaces",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "BrandTemplates",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    BrandId = table.Column<Guid>(type: "uuid", nullable: false),
                    TemplateId = table.Column<Guid>(type: "uuid", nullable: false),
                    Enabled = table.Column<bool>(type: "boolean", nullable: false),
                    WorkspaceId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BrandTemplates", x => x.Id);
                    table.ForeignKey(
                        name: "FK_BrandTemplates_Brands_BrandId",
                        column: x => x.BrandId,
                        principalTable: "Brands",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_BrandTemplates_Templates_TemplateId",
                        column: x => x.TemplateId,
                        principalTable: "Templates",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_BrandTemplates_Workspaces_WorkspaceId",
                        column: x => x.WorkspaceId,
                        principalTable: "Workspaces",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Pautas_ForcedTemplateId",
                table: "Pautas",
                column: "ForcedTemplateId");

            migrationBuilder.CreateIndex(
                name: "IX_BrandLibraryItems_BrandId_Kind",
                table: "BrandLibraryItems",
                columns: new[] { "BrandId", "Kind" });

            migrationBuilder.CreateIndex(
                name: "IX_BrandLibraryItems_WorkspaceId",
                table: "BrandLibraryItems",
                column: "WorkspaceId");

            migrationBuilder.CreateIndex(
                name: "IX_BrandTemplates_BrandId_TemplateId",
                table: "BrandTemplates",
                columns: new[] { "BrandId", "TemplateId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_BrandTemplates_TemplateId",
                table: "BrandTemplates",
                column: "TemplateId");

            migrationBuilder.CreateIndex(
                name: "IX_BrandTemplates_WorkspaceId",
                table: "BrandTemplates",
                column: "WorkspaceId");

            migrationBuilder.CreateIndex(
                name: "IX_Templates_WorkspaceId_Key",
                table: "Templates",
                columns: new[] { "WorkspaceId", "Key" },
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_Pautas_Templates_ForcedTemplateId",
                table: "Pautas",
                column: "ForcedTemplateId",
                principalTable: "Templates",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Pautas_Templates_ForcedTemplateId",
                table: "Pautas");

            migrationBuilder.DropTable(
                name: "BrandLibraryItems");

            migrationBuilder.DropTable(
                name: "BrandTemplates");

            migrationBuilder.DropTable(
                name: "Templates");

            migrationBuilder.DropIndex(
                name: "IX_Pautas_ForcedTemplateId",
                table: "Pautas");

            migrationBuilder.DropColumn(
                name: "ForcedTemplateId",
                table: "Pautas");
        }
    }
}
