"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { settingsApi, type AiConfig, type AiTestResult } from "@/lib/settings";
import { ApiError } from "@/lib/api";
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

/** Opções de modelo por provedor — o operador escolhe na lista (evita digitar e-mail no campo). */
const TEXT_MODELS: Record<string, { id: string; label: string }[]> = {
  gemini: [
    { id: "models/gemini-3.5-flash", label: "gemini-3.5-flash (recomendado)" },
    { id: "models/gemini-2.5-flash", label: "gemini-2.5-flash" },
    { id: "models/gemini-2.5-pro", label: "gemini-2.5-pro" },
  ],
  openai: [
    { id: "gpt-5.5", label: "gpt-5.5 (recomendado)" },
    { id: "gpt-4.1", label: "gpt-4.1" },
  ],
  grok: [{ id: "grok-4.3", label: "grok-4.3 (recomendado)" }],
  anthropic: [
    { id: "claude-opus-4-8", label: "claude-opus-4-8 (recomendado)" },
    { id: "claude-sonnet-4-5", label: "claude-sonnet-4-5" },
  ],
};

const IMAGE_MODELS: Record<string, { id: string; label: string }[]> = {
  gemini: [
    { id: "models/gemini-3.1-flash-image", label: "gemini-3.1-flash-image (recomendado)" },
    { id: "models/gemini-2.5-flash-image", label: "gemini-2.5-flash-image" },
  ],
  openai: [
    { id: "gpt-image-2", label: "gpt-image-2 (recomendado)" },
    { id: "gpt-image-1", label: "gpt-image-1" },
  ],
};

const DEFAULT_TEXT: Record<string, string> = {
  gemini: "models/gemini-3.5-flash",
  openai: "gpt-5.5",
  grok: "grok-4.3",
  anthropic: "claude-opus-4-8",
};

const DEFAULT_IMAGE: Record<string, string> = {
  gemini: "models/gemini-3.1-flash-image",
  openai: "gpt-image-2",
};

const CUSTOM = "__custom__";

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
            Provedor, modelos e chave de IA da sua conta. Escolha os modelos na lista e salve —
            <span className="font-medium text-ink"> não precisa colar a chave de novo</span> só para
            trocar o modelo. A chave é cifrada e nunca é exibida de volta.
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

function pickSelectValue(current: string, options: { id: string }[]): string {
  if (!current) return options[0]?.id ?? "";
  if (options.some((o) => o.id === current)) return current;
  return CUSTOM;
}

function AiConfigForm({ config, onSaved }: { config: AiConfig; onSaved: () => void }) {
  const [provider, setProvider] = useState(config.provider ?? "gemini");
  const [textModel, setTextModel] = useState(config.textModel ?? DEFAULT_TEXT[config.provider ?? "gemini"] ?? "");
  const [imageModel, setImageModel] = useState(
    config.imageModel ?? DEFAULT_IMAGE[config.provider ?? "gemini"] ?? "",
  );
  const [apiKey, setApiKey] = useState("");
  const [test, setTest] = useState<AiTestResult | null>(null);
  const [savedOk, setSavedOk] = useState(false);

  useEffect(() => {
    const p = config.provider ?? "gemini";
    setProvider(p);
    setTextModel(config.textModel ?? DEFAULT_TEXT[p] ?? "");
    setImageModel(config.imageModel ?? DEFAULT_IMAGE[p] ?? "");
  }, [config]);

  useEffect(() => {
    if (provider === "grok" || provider === "anthropic") {
      setImageModel("");
      return;
    }
    // Ao trocar provedor, se o modelo atual não pertence ao novo, aplica o recomendado.
    const texts = TEXT_MODELS[provider] ?? [];
    const images = IMAGE_MODELS[provider] ?? [];
    if (texts.length && !texts.some((t) => t.id === textModel) && textModel !== "") {
      setTextModel(DEFAULT_TEXT[provider] ?? texts[0].id);
    }
    if (images.length && imageModel && !images.some((t) => t.id === imageModel)) {
      setImageModel(DEFAULT_IMAGE[provider] ?? images[0].id);
    }
  }, [provider]); // eslint-disable-line react-hooks/exhaustive-deps -- só ao trocar provedor

  const save = useMutation({
    mutationFn: () =>
      settingsApi.saveAi({
        provider,
        textModel: textModel.trim() || null,
        imageModel: imageModel.trim() || null,
        apiKey: apiKey.trim() || undefined,
      }),
    onSuccess: (dto) => {
      setApiKey("");
      setTest(null);
      setSavedOk(true);
      // Atualiza cache imediatamente com o eco do POST (modelos efetivos gravados).
      onSaved();
      void dto;
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
      setSavedOk(false);
      onSaved();
    },
  });

  const geraImagem = provider === "gemini" || provider === "openai";
  const textOptions = TEXT_MODELS[provider] ?? [];
  const imageOptions = IMAGE_MODELS[provider] ?? [];
  const textSelect = pickSelectValue(textModel, textOptions);
  const imageSelect = pickSelectValue(imageModel, imageOptions);

  // Já configurado: Salvar SEMPRE disponível (persiste o que está na tela, sem exigir chave).
  // 1ª config: exige chave.
  const podeSalvar = provider.trim().length > 0 && (config.configured || apiKey.trim().length > 0);

  const saveErrorMsg =
    save.error instanceof ApiError
      ? save.error.message
      : save.isError
        ? "Não foi possível salvar. Verifique o provedor, os modelos e a chave."
        : null;

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
            setSavedOk(false);
            if (podeSalvar) save.mutate();
          }}
        >
          <Field label="Provedor" hint="Quem gera texto e imagem para a sua conta.">
            <Select
              value={provider}
              onChange={(e) => {
                setSavedOk(false);
                setProvider(e.target.value);
              }}
            >
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Modelo de texto" hint="Escolha na lista. Isso é o que a geração usa de fato.">
            <Select
              value={textSelect}
              onChange={(e) => {
                setSavedOk(false);
                const v = e.target.value;
                if (v === CUSTOM) return;
                setTextModel(v);
              }}
            >
              {textOptions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
              {textSelect === CUSTOM && (
                <option value={CUSTOM}>Personalizado (abaixo)</option>
              )}
            </Select>
            {textSelect === CUSTOM && (
              <Input
                className="mt-2"
                value={textModel}
                onChange={(e) => {
                  setSavedOk(false);
                  setTextModel(e.target.value);
                }}
                placeholder="id do modelo"
              />
            )}
          </Field>

          <Field
            label="Modelo de imagem"
            hint={
              geraImagem
                ? "Escolha na lista. Não use e-mail neste campo — isso causava HTTP 404."
                : "Este provedor não gera imagem — a geração de imagem usa Gemini/OpenAI."
            }
          >
            <Select
              value={geraImagem ? imageSelect : ""}
              disabled={!geraImagem}
              onChange={(e) => {
                setSavedOk(false);
                const v = e.target.value;
                if (v === CUSTOM) return;
                setImageModel(v);
              }}
            >
              {imageOptions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
              {geraImagem && imageSelect === CUSTOM && (
                <option value={CUSTOM}>Personalizado (abaixo)</option>
              )}
              {!geraImagem && <option value="">—</option>}
            </Select>
            {geraImagem && imageSelect === CUSTOM && (
              <Input
                className="mt-2"
                value={imageModel}
                onChange={(e) => {
                  setSavedOk(false);
                  setImageModel(e.target.value);
                }}
                placeholder="id do modelo de imagem"
              />
            )}
          </Field>

          <Field
            label={config.configured ? "Nova chave de IA (opcional)" : "Chave de IA"}
            hint={
              config.configured
                ? "Deixe em branco para manter a chave atual. Preencha só se quiser trocá-la."
                : "Cole a API key do provedor (não o e-mail da conta)."
            }
          >
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => {
                setSavedOk(false);
                setApiKey(e.target.value);
              }}
              placeholder={config.configured ? "•••••••• (mantém a atual se vazio)" : "cole a chave do provedor"}
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

          {savedOk && !save.isError && (
            <p role="status" className="text-sm text-ink/70">
              Configuração salva. Os modelos acima passam a valer na próxima geração.
            </p>
          )}
          {saveErrorMsg && (
            <p role="alert" className="text-sm text-red-500">
              {saveErrorMsg}
            </p>
          )}
        </form>
      </Card>

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
