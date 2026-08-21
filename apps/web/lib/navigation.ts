// R2 — Arquitetura de informação: a ESPINHA do funil em ≤6 áreas (fonte única).
// O funil mental do operador (HANDOFF §1):
//   ideia → pauta → gerar → revisar → aprovar → agendar → publicar → aprender
// 19 destinos planos viravam ruído (Hick/Miller). Aqui agrupamos em 6 áreas na ORDEM
// do funil; cada área tem sub-rotas bookmarkáveis. A sidebar, os redirects e o
// breadcrumb derivam TODOS deste módulo — mexer aqui propaga para tudo.
//
// "5 áreas era hipótese; fallback 6" (HANDOFF §4 R2): Conteúdo agrega 4 grupos
// (pautas+ideias+gerar+conteúdo), então 6 áreas é a decisão (não forçamos 5 e
// sobrecarregamos uma aba — isso violaria o próprio Hick/Miller que justifica a fusão).

export type NavArea = {
  /** id estável da área (usado em testes/active-state). */
  id: string;
  /** rótulo PT-BR exibido na sidebar. */
  label: string;
  /** rota raiz da área (o clique no item leva aqui). */
  href: string;
  /** ícone (nome exportado em components/icons). */
  icon: string;
  /** posição no funil (1..n) — alimenta o indicador de ciclo de vida. */
  stage: number;
  /** sub-rotas da área (sub-nav contextual; preserva deep-links).
   *  `group` (opcional) agrupa visualmente itens afins na sub-nav — itens com o
   *  mesmo group ficam juntos, e a UI insere um separador quando o group muda.
   *  Itens sem group renderizam soltos (compat). NÃO afeta rotas/deep-links. */
  children?: { label: string; href: string; group?: string }[];
  /** prefixos de rota que pertencem a esta área (p/ active-state e breadcrumb). */
  match: string[];
};

export const NAV_AREAS: NavArea[] = [
  {
    id: "inicio",
    label: "Início",
    href: "/dashboard",
    icon: "IconHome",
    stage: 0,
    match: ["/dashboard"],
  },
  {
    id: "conteudo",
    label: "Conteúdo",
    href: "/pautas",
    icon: "IconLayers",
    stage: 1,
    children: [
      { label: "Pautas", href: "/pautas" },
      { label: "Ideias", href: "/ideas" },
      { label: "Gerar", href: "/create" },
    ],
    match: ["/pautas", "/ideas", "/create", "/content"],
  },
  {
    id: "revisao",
    label: "Revisão & Agenda",
    href: "/approvals",
    icon: "IconCheckCircle",
    stage: 2,
    children: [
      { label: "Aprovações", href: "/approvals" },
      { label: "Calendário", href: "/calendar" },
    ],
    match: ["/approvals", "/calendar"],
  },
  {
    id: "publicacao",
    label: "Publicação",
    href: "/publishing",
    icon: "IconSend",
    stage: 3,
    match: ["/publishing"],
  },
  {
    id: "desempenho",
    label: "Desempenho",
    href: "/insights",
    icon: "IconChart",
    stage: 4,
    children: [
      { label: "Insights", href: "/insights" },
      { label: "Histórico", href: "/history" },
    ],
    match: ["/insights", "/history"],
  },
  {
    id: "ajustes",
    label: "Marca & Ajustes",
    href: "/brand",
    icon: "IconSettings",
    stage: 5,
    // Agrupado em 4 famílias (Hick/Miller): Marca · IA · Conexões · Conta.
    // As rotas físicas continuam idênticas (zero redirect); só a apresentação agrupa.
    children: [
      { label: "Marca", href: "/brand", group: "Marca" },
      { label: "Marcas", href: "/settings/brands", group: "Marca" },
      { label: "IA", href: "/settings/ai", group: "IA" },
      { label: "Instruções da IA", href: "/settings/prompts", group: "IA" },
      { label: "Aprovação", href: "/settings/approval", group: "IA" },
      { label: "Instagram", href: "/settings/instagram", group: "Conexões" },
      { label: "Membros", href: "/settings/users", group: "Conta" },
      { label: "Uso", href: "/settings/usage", group: "Conta" },
      { label: "Fuso", href: "/settings/workspace", group: "Conta" },
      { label: "Auditoria", href: "/settings/audit", group: "Conta" },
      { label: "Banco de dados", href: "/admin/database", group: "Conta" },
    ],
    match: ["/brand", "/settings", "/admin"],
  },
];

/** Resolve a área ativa a partir do pathname (match por prefixo mais específico). */
export function activeArea(pathname: string): NavArea | undefined {
  // ordena os matches por comprimento desc p/ "/content" não roubar de "/settings", etc.
  let best: { area: NavArea; len: number } | undefined;
  for (const area of NAV_AREAS) {
    for (const m of area.match) {
      // Match por SEGMENTO de rota: exato (===) ou prefixo seguido de "/". NÃO startsWith
      // cru — senão "/brandzilla" casaria com "/brand" e "/createx" com "/create" (colisão
      // de prefixo). Cada match é uma rota canônica; rotas reais ou são ela, ou descem dela.
      const hit = pathname === m || pathname.startsWith(m + "/");
      if (hit && (!best || m.length > best.len)) best = { area, len: m.length };
    }
  }
  return best?.area;
}

/** Sub-rotas da área ativa (p/ a sub-nav contextual). */
export function activeChildren(pathname: string): NonNullable<NavArea["children"]> {
  return activeArea(pathname)?.children ?? [];
}

// ── Tabela de REDIRECT old→new (HANDOFF §4 R2: artefato obrigatório) ───────────
// Muscle-memory/bookmarks/deep-links externos não podem quebrar em silêncio.
// Toda rota antiga que MUDOU de lar aponta para a nova. Rotas que continuam onde
// estavam (a maioria — só reagrupamos a NAV, não movemos as rotas) não entram aqui.
// Hoje a reorganização é de NAVEGAÇÃO (a sidebar agrupa), e as rotas físicas
// permanecem — então NÃO há redirect a fazer. Esta tabela existe como contrato:
// se uma fase futura MOVER uma rota, registra aqui e o middleware honra.
export const ROUTE_REDIRECTS: Record<string, string> = {
  // (vazio por design nesta fase — ver comentário acima. Ex. futuro:
  //  "/publishing": "/revisao/falhas")
};
