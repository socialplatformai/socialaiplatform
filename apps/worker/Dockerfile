# ── build ──────────────────────────────────────────────────────────────────
# H4/S-23: o contexto de build é a RAIZ do repo (ver docker-compose.yml), porque o worker
# referencia ../../libs/SocialAi.Core/SocialAi.Core.csproj (Domain+Data+SecretProtector
# compartilhados). Antes o contexto era ./apps e o worker referenciava a API (Web SDK).
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY ["apps/worker/Worker.csproj", "apps/worker/"]
COPY ["libs/SocialAi.Core/SocialAi.Core.csproj", "libs/SocialAi.Core/"]
RUN dotnet restore "apps/worker/Worker.csproj"
COPY apps/worker/ apps/worker/
COPY libs/SocialAi.Core/ libs/SocialAi.Core/
RUN dotnet publish "apps/worker/Worker.csproj" -c Release -o /app/publish /p:UseAppHost=false

# ── runtime ──────────────────────────────────────────────────────────────────
# H4/S-23: runtime base (não aspnet) — o worker não depende mais do framework ASP.NET,
# porque referencia SocialAi.Core (não a API/Web). Imagem menor.
FROM mcr.microsoft.com/dotnet/runtime:8.0 AS final
WORKDIR /app
COPY --from=build /app/publish .
ENTRYPOINT ["dotnet", "Worker.dll"]
