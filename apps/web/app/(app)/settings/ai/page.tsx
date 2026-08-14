"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { settingsApi, type AiConfig, type AiTestResult } from "@/lib/settings";
import { Badge, Button, Card, Field, Input, PageHeader, PageShell, SectionLabel, Select } from "@/components/ui";

// B (ADR-0008): Configurações de IA por workspace. Provider/modelo/chave — a chave é
// write-only (cifrada em repouso, nunca volta do backend). "Testar conexão" valida a
// chave salva contra o provider sem nunca exibi-la. Admin-only (o backend retorna 403
// para Member; a UI assume que só Admin chega aqui via navegação).

const PROVIDERS = [
  { id: "gemini", label: "Google Gemini" },
  { id: "openai", label: "OpenAI" },
  { id: "grok", label: "xAI (Grok)" },
  { id: "anthropic", label: "Anthropic (Claude)" },
];

// Placeholders por provedor — identificadores recomendados (jun/2026). Só dica de UI; em branco usa o
// default do provedor. Claude não gera imagem (campo de imagem fica desabilitado p/ anthropic).
const MODEL_HINTS: Record<string, { text: string; image: string }> = {
  gemini: { text: "models/gemini-3.5-flash", image: "models/gemini-3.1-flash-image" },
  openai: { text: "gpt-5.5", image: "gpt-image-2" },
  grok: { text: "grok-4.3", image: "(Grok não gera imagem — use gemini/openai)" },
  anthropic: { text: "claude-opus-4-8", image: "(Claude não gera imagem — use gemini/openai)" },
};

export default function AiSettingsPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["settings", "ai"],
    queryFn: () => settingsApi.getAi(),
  });

  return (
    <PageShell width="form">
      <PageHeader
        eyebrow="Configurações"
        title="Inteligência artificial"
        description={
          <>
            Provedor, modelos e chave de IA da sua conta. A chave é{" "}
            <span className="font-medium text-ink">cifrada em repouso</span> e nunca é exibida de volta —
            para trocá-la, basta salvar uma nova. Sem chave, a plataforma roda em{" "}
            <span className="font-medium text-ink">modo simulado</span> (sem geração real).
          </>
        }
      />

      {isLoading ? (
        <Card>
          <p className="text-sm text-ink/65">Carregando…</p>
        </Card>
      ) : isError ? (
        <Card>
          <p role="alert" className="text-sm text-ink/70">
            Não foi possível carregar a configuração de IA. Tente novamente.
          </p>
        </Card>
      ) : (
        <AiConfigForm
          config={data!}
          onSaved={() => qc.invalidateQueries({ queryKey: ["settings", "ai"] })}
        />
      )}
    </PageShell>
  );
}

function AiConfigForm({ config, onSaved }: { config: AiConfig; onSaved: () => void }) {
  const [provider, setProvider] = useState(config.provider ?? "gemini");
  const [textModel, setTextModel] = useState(config.textModel ?? "");
  const [imageModel, setImageModel] = useState(config.imageModel ?? "");
  const [apiKey, setApiKey] = useState("");
  const [test, setTest] = useState<AiTestResult | null>(null);

  // Quando a config carregada muda (ex.: após salvar), ressincroniza os campos de metadados.
  useEffect(() => {
    setProvider(config.provider ?? "gemini");
    setTextModel(config.textModel ?? "");
    setImageModel(config.imageModel ?? "");
  }, [config]);

  // Provedor que não gera imagem (grok/anthropic) → limpa o modelo de imagem para não enviar
  // um valor remanescente de um provedor anterior (o campo fica desabilitado).
  useEffect(() => {
    if (provider === "grok" || provider === "anthropic") setImageModel("");
  }, [provider]);

  const save = useMutation({
    mutationFn: () =>
      settingsApi.saveAi({
        provider,
        textModel: textModel.trim() || null,
        imageModel: imageModel.trim() || null,
        apiKey: apiKey.trim(),
      }),
    onSuccess: () => {
      setApiKey(""); // a chave é write-only: limpa o campo após salvar
      setTest(null);
      onSaved();
    },
  });

  const testConn = useMutation({
    mutationFn: () => settingsApi.testAi(),
    onSuccess: (r) => setTest(r),
  });

  const remove = useMutation({
    mutationFn: () => settingsApi.deleteAi(),
    onSuccess: () => {
      setApiKey("");
      setTest(null);
      onSaved();
    },
  });

  const podeSalvar = provider.trim().length > 0 && apiKey.trim().length > 0;
  // grok e anthropic não geram imagem → o campo de modelo de imagem fica desabilitado.
  const geraImagem = provider === "gemini" || provider === "openai";

  return (
    <div className="space-y-6">
      <Card>
        <div className="mb-5 flex items-center justify-between gap-4">
          <SectionLabel>Provedor de IA</SectionLabel>
          {config.configured ? (
            <Badge tone="medium">configurado</Badge>
          ) : (
            <Badge tone="low">modo simulado</Badge>
          )}
        </div>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (podeSalvar) save.mutate();
          }}
        >
          <Field label="Provedor" hint="Quem gera texto e imagem para a sua conta.">
            <Select value={provider} onChange={(e) => setProvider(e.target.value)}>
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Modelo de texto (opcional)"
            hint="Em branco usa o modelo mais capaz atual do provedor."
          >
            <Input
              value={textModel}
              onChange={(e) => setTextModel(e.target.value)}
              placeholder={`ex.: ${MODEL_HINTS[provider]?.text ?? "modelo do provedor"}`}
            />
          </Field>

          <Field
            label="Modelo de imagem (opcional)"
            hint={
              geraImagem
                ? "Em branco usa o modelo de imagem padrão do provedor."
                : "Este provedor não gera imagem — a geração de imagem usa Gemini/OpenAI."
            }
          >
            <Input
              value={imageModel}
              onChange={(e) => setImageModel(e.target.value)}
              placeholder={`ex.: ${MODEL_HINTS[provider]?.image ?? "modelo de imagem"}`}
              disabled={!geraImagem}
            />
          </Field>

          <Field
            label={config.configured ? "Nova chave de IA" : "Chave de IA"}
            hint="A chave é cifrada e nunca exibida. Salvar exige informá-la (inclusive ao trocar provedor/modelo)."
          >
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={config.configured ? "•••••••• (salva)" : "cole a chave do provedor"}
              autoComplete="off"
            />
          </Field>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button type="submit" disabled={!podeSalvar || save.isPending}>
              {save.isPending ? "Salvando…" : "Salvar"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={!config.configured || testConn.isPending}
              onClick={() => testConn.mutate()}
            >
              {testConn.isPending ? "Testando…" : "Testar conexão"}
            </Button>
            {config.configured && (
              <span className="ml-auto">
                <Button
                  type="button"
                  variant="danger"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate()}
                >
                  {remove.isPending ? "Removendo…" : "Remover"}
                </Button>
              </span>
            )}
          </div>

          {save.isError && (
            <p role="alert" className="text-sm text-red-500">
              Não foi possível salvar. Verifique o provedor e a chave.
            </p>
          )}
        </form>
      </Card>

      {/* Resultado do "Testar conexão" — ok/detail PT-BR, nunca a chave */}
      {test && (
        <Card>
          <div className="flex items-start gap-3">
            <Badge tone={test.ok ? "medium" : "high"}>{test.ok ? "conectado" : "falhou"}</Badge>
            <p className={`text-sm ${test.ok ? "text-ink/70" : "text-ink/80"}`}>{test.detail}</p>
          </div>
        </Card>
      )}
    </div>
  );
}
