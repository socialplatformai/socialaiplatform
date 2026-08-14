using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SocialAi.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddBrandContract : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_BrandKits_Brands_BrandId",
                table: "BrandKits");

            migrationBuilder.DropForeignKey(
                name: "FK_Campaigns_Brands_BrandId",
                table: "Campaigns");

            migrationBuilder.DropForeignKey(
                name: "FK_Competitors_Brands_BrandId",
                table: "Competitors");

            migrationBuilder.DropForeignKey(
                name: "FK_Contents_Brands_BrandId",
                table: "Contents");

            migrationBuilder.DropForeignKey(
                name: "FK_InstagramAccounts_Brands_BrandId",
                table: "InstagramAccounts");

            migrationBuilder.DropForeignKey(
                name: "FK_Pautas_Brands_BrandId",
                table: "Pautas");

            migrationBuilder.AlterColumn<Guid>(
                name: "BrandId",
                table: "Pautas",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"),
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);

            migrationBuilder.AlterColumn<Guid>(
                name: "BrandId",
                table: "InstagramAccounts",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"),
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);

            migrationBuilder.AlterColumn<Guid>(
                name: "BrandId",
                table: "Contents",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"),
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);

            migrationBuilder.AlterColumn<Guid>(
                name: "BrandId",
                table: "Competitors",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"),
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);

            migrationBuilder.AlterColumn<Guid>(
                name: "BrandId",
                table: "Campaigns",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"),
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);

            migrationBuilder.AlterColumn<Guid>(
                name: "BrandId",
                table: "BrandKits",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"),
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);

            migrationBuilder.AddForeignKey(
                name: "FK_BrandKits_Brands_BrandId",
                table: "BrandKits",
                column: "BrandId",
                principalTable: "Brands",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_Campaigns_Brands_BrandId",
                table: "Campaigns",
                column: "BrandId",
                principalTable: "Brands",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_Competitors_Brands_BrandId",
                table: "Competitors",
                column: "BrandId",
                principalTable: "Brands",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_Contents_Brands_BrandId",
                table: "Contents",
                column: "BrandId",
                principalTable: "Brands",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_InstagramAccounts_Brands_BrandId",
                table: "InstagramAccounts",
                column: "BrandId",
                principalTable: "Brands",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_Pautas_Brands_BrandId",
                table: "Pautas",
                column: "BrandId",
                principalTable: "Brands",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_BrandKits_Brands_BrandId",
                table: "BrandKits");

            migrationBuilder.DropForeignKey(
                name: "FK_Campaigns_Brands_BrandId",
                table: "Campaigns");

            migrationBuilder.DropForeignKey(
                name: "FK_Competitors_Brands_BrandId",
                table: "Competitors");

            migrationBuilder.DropForeignKey(
                name: "FK_Contents_Brands_BrandId",
                table: "Contents");

            migrationBuilder.DropForeignKey(
                name: "FK_InstagramAccounts_Brands_BrandId",
                table: "InstagramAccounts");

            migrationBuilder.DropForeignKey(
                name: "FK_Pautas_Brands_BrandId",
                table: "Pautas");

            migrationBuilder.AlterColumn<Guid>(
                name: "BrandId",
                table: "Pautas",
                type: "uuid",
                nullable: true,
                oldClrType: typeof(Guid),
                oldType: "uuid");

            migrationBuilder.AlterColumn<Guid>(
                name: "BrandId",
                table: "InstagramAccounts",
                type: "uuid",
                nullable: true,
                oldClrType: typeof(Guid),
                oldType: "uuid");

            migrationBuilder.AlterColumn<Guid>(
                name: "BrandId",
                table: "Contents",
                type: "uuid",
                nullable: true,
                oldClrType: typeof(Guid),
                oldType: "uuid");

            migrationBuilder.AlterColumn<Guid>(
                name: "BrandId",
                table: "Competitors",
                type: "uuid",
                nullable: true,
                oldClrType: typeof(Guid),
                oldType: "uuid");

            migrationBuilder.AlterColumn<Guid>(
                name: "BrandId",
                table: "Campaigns",
                type: "uuid",
                nullable: true,
                oldClrType: typeof(Guid),
                oldType: "uuid");

            migrationBuilder.AlterColumn<Guid>(
                name: "BrandId",
                table: "BrandKits",
                type: "uuid",
                nullable: true,
                oldClrType: typeof(Guid),
                oldType: "uuid");

            migrationBuilder.AddForeignKey(
                name: "FK_BrandKits_Brands_BrandId",
                table: "BrandKits",
                column: "BrandId",
                principalTable: "Brands",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_Campaigns_Brands_BrandId",
                table: "Campaigns",
                column: "BrandId",
                principalTable: "Brands",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_Competitors_Brands_BrandId",
                table: "Competitors",
                column: "BrandId",
                principalTable: "Brands",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_Contents_Brands_BrandId",
                table: "Contents",
                column: "BrandId",
                principalTable: "Brands",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_InstagramAccounts_Brands_BrandId",
                table: "InstagramAccounts",
                column: "BrandId",
                principalTable: "Brands",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_Pautas_Brands_BrandId",
                table: "Pautas",
                column: "BrandId",
                principalTable: "Brands",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }
    }
}
