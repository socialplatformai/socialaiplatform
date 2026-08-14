# ── build ──────────────────────────────────────────────────────────────────
# H4/S-23: contexto = raiz do repo, porque a API referencia libs/SocialAi.Core
# (Domain+Data+Migrations compartilhados). Worker-in-API: a API também referencia
# apps/worker/Worker.csproj (hospeda os jobs no mesmo processo no free-tier), então
# o projeto worker precisa entrar no contexto de build — senão o restore/publish falha.
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY ["apps/api/Api.csproj", "apps/api/"]
COPY ["apps/worker/Worker.csproj", "apps/worker/"]
COPY ["libs/SocialAi.Core/SocialAi.Core.csproj", "libs/SocialAi.Core/"]
RUN dotnet restore "apps/api/Api.csproj"
COPY apps/api/ apps/api/
COPY apps/worker/ apps/worker/
COPY libs/SocialAi.Core/ libs/SocialAi.Core/
RUN dotnet publish "apps/api/Api.csproj" -c Release -o /app/publish /p:UseAppHost=false

# ── runtime ──────────────────────────────────────────────────────────────────
FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS final
WORKDIR /app
# curl para o healthcheck do docker-compose
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/publish .
EXPOSE 5080
ENV ASPNETCORE_URLS=http://+:5080
ENTRYPOINT ["dotnet", "Api.dll"]
