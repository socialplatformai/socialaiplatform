// Carrega o .env da RAIZ do monorepo como EFEITO DE IMPORT — precisa ser o PRIMEIRO import do
// server.ts. Em ESM, todos os imports são resolvidos (e seus efeitos rodam) antes de qualquer
// statement do módulo importador; então um `dotenv.config()` solto no server.ts rodaria DEPOIS de
// config.ts/providers já terem lido process.env. Isolando o efeito aqui, ele roda primeiro.
// No Docker as env vars já vêm do compose; dotenv não sobrescreve o que já existe (override:false).
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });
