/**
 * Arquétipos de carrossel v2 — dramaturgia-driven.
 *
 * Destilados da spec atômica "Templates atômicos em camadas" (operador) + cabeça de social-media
 * senior. Os 4 built-in originais (index.ts) são todos PAS/conversão; estes cobrem os FORMATOS que
 * de fato performam no feed (save/send-driven), mapeando a função narrativa de cada slide à sua
 * posição — Hook → Tensão → Valor → Prova → Virada/CTA (a "dramaturgia do carrossel").
 *
 * Reusam o vocabulário tipado que o render JÁ honra (SlideType + SlideLayout) — zero render novo.
 * Constraints seguem a spec: headline ≤48-56, stat ≤6 glyphs, body ≤140, bullets 3-5.
 */

import type { CarouselTemplate } from '@/types/pipeline'

// ============================================
// LISTICLE / "X DICAS" — o carrossel save-driven nº1 do feed
// ============================================
export const listicleTemplate: CarouselTemplate = {
  id: 'listicle',
  name: 'Lista de dicas',
  description: 'Para listas e dicas práticas ("5 erros…", "7 formas de…"). Formato campeão de SAVES no feed — entrega valor direto, slide a slide.',
  slideCount: 7,
  recommendedFor: ['awareness', 'consideration'],
  bestFor: ['dicas e listas', 'erros comuns', 'checklists', 'conteúdo educativo'],
  slides: [
    {
      index: 1, type: 'cover', purpose: 'Hook com o NÚMERO da lista — promete valor contável e escaneável',
      layout: 'centered-headline', emotionalBeat: 'curiosity',
      requiredElements: ['headline'], optionalElements: ['eyebrow', 'caption'],
      copyConstraints: {
        eyebrow: { maxChars: 24, style: 'categoria-ou-nicho' },
        headline: { maxChars: 48, style: 'numero-mais-promessa-ex-5-erros-que' },
        caption: { maxChars: 40, style: 'swipe-hint' },
      },
      visualNotes: 'Número grande como protagonista. Background da marca, alto contraste.',
    },
    {
      index: 2, type: 'problem', purpose: 'Por que essa lista importa — o custo de NÃO saber isso',
      layout: 'headline-subheadline', emotionalBeat: 'pain',
      requiredElements: ['headline', 'body'],
      copyConstraints: {
        headline: { maxChars: 50, style: 'o-que-esta-em-jogo' },
        body: { maxChars: 140, style: 'consequencia-de-ignorar' },
      },
      visualNotes: 'Tom mais sério, prepara o terreno pro valor.',
    },
    {
      index: 3, type: 'features', purpose: 'Item 1 da lista — o mais forte primeiro (não enterre o ouro)',
      layout: 'headline-subheadline', emotionalBeat: 'hope',
      requiredElements: ['headline', 'body'], optionalElements: ['caption'],
      copyConstraints: {
        headline: { maxChars: 44, style: 'numero-item-mais-titulo-acionavel' },
        body: { maxChars: 140, style: 'explicacao-pratica-e-especifica' },
        caption: { maxChars: 50, style: 'exemplo-ou-micro-dica' },
      },
      visualNotes: 'Número do item destacado. Consistência visual entre os itens.',
    },
    {
      index: 4, type: 'features', purpose: 'Item 2 da lista', layout: 'headline-subheadline',
      emotionalBeat: 'excitement', requiredElements: ['headline', 'body'], optionalElements: ['caption'],
      copyConstraints: {
        headline: { maxChars: 44, style: 'numero-item-mais-titulo-acionavel' },
        body: { maxChars: 140, style: 'explicacao-pratica-e-especifica' },
        caption: { maxChars: 50, style: 'exemplo-ou-micro-dica' },
      },
      visualNotes: 'Variação sutil de cor, mesmo esqueleto.',
    },
    {
      index: 5, type: 'features', purpose: 'Item 3 da lista — o clímax (o item mais memorável)',
      layout: 'headline-subheadline', emotionalBeat: 'empowerment',
      requiredElements: ['headline', 'body'], optionalElements: ['caption'],
      copyConstraints: {
        headline: { maxChars: 44, style: 'numero-item-mais-titulo-acionavel' },
        body: { maxChars: 140, style: 'explicacao-pratica-e-especifica' },
        caption: { maxChars: 50, style: 'exemplo-ou-micro-dica' },
      },
      visualNotes: 'Pode ganhar destaque extra (o item-âncora da retomada de atenção).',
    },
    {
      index: 6, type: 'benefits', purpose: 'Recap — empilha os itens num resumo escaneável (reforça o save)',
      layout: 'bullet-points', emotionalBeat: 'trust',
      requiredElements: ['headline', 'bullets'],
      copyConstraints: {
        headline: { maxChars: 35, style: 'recapitulando-ou-pra-fixar' },
        bullets: { count: 3, maxChars: 50, style: 'item-resumido-1-linha' },
      },
      visualNotes: 'Lista visual — o slide que o usuário volta pra consultar (gera save).',
    },
    {
      index: 7, type: 'cta', purpose: 'CTA orientado a SAVE/SEND — "salva pra não esquecer" / "manda pra quem precisa"',
      layout: 'cta-focused', emotionalBeat: 'empowerment',
      requiredElements: ['headline', 'cta'], optionalElements: ['caption'],
      copyConstraints: {
        headline: { maxChars: 45, style: 'convite-a-salvar-ou-compartilhar' },
        cta: { maxChars: 25, style: 'acao-clara-salvar-seguir-comentar' },
        caption: { maxChars: 60, style: 'reforco-do-valor' },
      },
      visualNotes: 'CTA de baixo comprometimento (save/send), não venda dura. Marca presente.',
    },
  ],
}

// ============================================
// COMPARATIVO — Antes/Depois ou A×B (alto engajamento, lente "comparison" da spec)
// ============================================
export const comparisonTemplate: CarouselTemplate = {
  id: 'comparison',
  name: 'Comparativo (antes/depois)',
  description: 'Para contrastar dois caminhos: antes×depois, errado×certo, comum×SEU método. A tensão visual do contraste prende e converte.',
  slideCount: 6,
  recommendedFor: ['consideration', 'conversion'],
  bestFor: ['antes e depois', 'errado vs certo', 'comparação de métodos', 'reposicionamento'],
  slides: [
    {
      index: 1, type: 'cover', purpose: 'Hook que promete o contraste — "a diferença entre X e Y"',
      layout: 'centered-headline', emotionalBeat: 'curiosity',
      requiredElements: ['headline'], optionalElements: ['eyebrow'],
      copyConstraints: {
        eyebrow: { maxChars: 24, style: 'tema-da-comparacao' },
        headline: { maxChars: 52, style: 'promessa-de-contraste-ou-pergunta' },
      },
      visualNotes: 'Sugere dualidade já na capa (cor dividida ou seta).',
    },
    {
      index: 2, type: 'problem', purpose: 'O lado A — o jeito comum/antigo/errado (a dor familiar)',
      layout: 'comparison-columns', emotionalBeat: 'pain',
      requiredElements: ['headline', 'body'],
      copyConstraints: {
        headline: { maxChars: 40, style: 'rotulo-do-lado-A-ex-o-jeito-comum' },
        body: { maxChars: 140, style: 'descricao-do-problema-do-lado-A' },
      },
      visualNotes: 'Lado A com tom mais apagado/frio — o "antes".',
    },
    {
      index: 3, type: 'solution', purpose: 'O lado B — o jeito novo/certo/SEU método (a virada)',
      layout: 'comparison-columns', emotionalBeat: 'hope',
      requiredElements: ['headline', 'body'],
      copyConstraints: {
        headline: { maxChars: 40, style: 'rotulo-do-lado-B-ex-o-jeito-certo' },
        body: { maxChars: 140, style: 'descricao-da-solucao-do-lado-B' },
      },
      visualNotes: 'Lado B com a cor accent da marca — o "depois", energia positiva.',
    },
    {
      index: 4, type: 'benefits', purpose: 'O que muda na prática — os ganhos concretos do lado B',
      layout: 'bullet-points', emotionalBeat: 'excitement',
      requiredElements: ['headline', 'bullets'],
      copyConstraints: {
        headline: { maxChars: 35, style: 'o-que-voce-ganha-ao-mudar' },
        bullets: { count: 3, maxChars: 50, style: 'ganho-concreto-do-lado-B' },
      },
      visualNotes: 'Lista de ganhos, cor accent.',
    },
    {
      index: 5, type: 'social-proof', purpose: 'Prova de que o lado B funciona — número ou depoimento curto',
      layout: 'stat-highlight', emotionalBeat: 'trust',
      requiredElements: ['stat', 'statContext'], optionalElements: ['body'],
      copyConstraints: {
        stat: { maxChars: 6, style: 'numero-impactante-com-unidade' },
        statContext: { maxChars: 80, style: 'o-que-o-numero-prova' },
      },
      visualNotes: 'Número grande — quebra o ceticismo no momento da retomada.',
    },
    {
      index: 6, type: 'cta', purpose: 'CTA — "escolha o lado B" (ação para fazer a virada)',
      layout: 'cta-focused', emotionalBeat: 'empowerment',
      requiredElements: ['headline', 'cta'],
      copyConstraints: {
        headline: { maxChars: 45, style: 'convite-a-fazer-a-virada' },
        cta: { maxChars: 25, style: 'acao-clara' },
      },
      visualNotes: 'CTA confiante, cor accent, energia de fecho.',
    },
  ],
}

// ============================================
// MITO × VERDADE — myth-busting (autoridade + save)
// ============================================
export const mythBustingTemplate: CarouselTemplate = {
  id: 'myth-busting',
  name: 'Mito × Verdade',
  description: 'Para desmontar crenças erradas do nicho ("Mito: … Verdade: …"). Constrói autoridade e gera saves — o público adora ter razão.',
  slideCount: 7,
  recommendedFor: ['awareness', 'consideration'],
  bestFor: ['quebrar mitos', 'crenças do nicho', 'autoridade', 'educar o público'],
  slides: [
    {
      index: 1, type: 'cover', purpose: 'Hook provocativo — "X mitos que te sabotam" / "pare de acreditar nisso"',
      layout: 'centered-headline', emotionalBeat: 'curiosity',
      requiredElements: ['headline'], optionalElements: ['eyebrow', 'caption'],
      copyConstraints: {
        eyebrow: { maxChars: 24, style: 'nicho-ou-tema' },
        headline: { maxChars: 50, style: 'provocacao-sobre-crenca-errada' },
        caption: { maxChars: 40, style: 'swipe-hint' },
      },
      visualNotes: 'Tensão na capa — o público se reconhece no mito.',
    },
    {
      index: 2, type: 'problem', purpose: 'Mito 1 — afirma a crença comum (o público concorda… por enquanto)',
      layout: 'headline-subheadline', emotionalBeat: 'curiosity',
      requiredElements: ['headline', 'body'],
      copyConstraints: {
        headline: { maxChars: 48, style: 'MITO-mais-a-crenca-comum' },
        body: { maxChars: 120, style: 'por-que-todo-mundo-acredita' },
      },
      visualNotes: 'Rótulo "MITO" visível. Tom neutro-cético.',
    },
    {
      index: 3, type: 'solution', purpose: 'Verdade 1 — desmonta o mito com o fato/explicação',
      layout: 'headline-subheadline', emotionalBeat: 'relief',
      requiredElements: ['headline', 'body'],
      copyConstraints: {
        headline: { maxChars: 48, style: 'VERDADE-mais-o-fato' },
        body: { maxChars: 140, style: 'explicacao-que-desmonta-o-mito' },
      },
      visualNotes: 'Rótulo "VERDADE" com cor accent. A revelação.',
    },
    {
      index: 4, type: 'problem', purpose: 'Mito 2', layout: 'headline-subheadline', emotionalBeat: 'curiosity',
      requiredElements: ['headline', 'body'],
      copyConstraints: {
        headline: { maxChars: 48, style: 'MITO-mais-a-crenca-comum' },
        body: { maxChars: 120, style: 'por-que-todo-mundo-acredita' },
      },
      visualNotes: 'Mesmo esqueleto do mito 1.',
    },
    {
      index: 5, type: 'solution', purpose: 'Verdade 2', layout: 'headline-subheadline', emotionalBeat: 'relief',
      requiredElements: ['headline', 'body'],
      copyConstraints: {
        headline: { maxChars: 48, style: 'VERDADE-mais-o-fato' },
        body: { maxChars: 140, style: 'explicacao-que-desmonta-o-mito' },
      },
      visualNotes: 'Mesmo esqueleto da verdade 1.',
    },
    {
      index: 6, type: 'benefits', purpose: 'O que fazer com isso — a verdade aplicada (valor prático)',
      layout: 'headline-subheadline', emotionalBeat: 'empowerment',
      requiredElements: ['headline', 'body'],
      copyConstraints: {
        headline: { maxChars: 40, style: 'agora-que-voce-sabe' },
        body: { maxChars: 140, style: 'como-agir-com-a-verdade' },
      },
      visualNotes: 'Transição do mito pro pitch suave.',
    },
    {
      index: 7, type: 'cta', purpose: 'CTA — salvar/seguir pra não cair mais nos mitos',
      layout: 'cta-focused', emotionalBeat: 'trust',
      requiredElements: ['headline', 'cta'], optionalElements: ['caption'],
      copyConstraints: {
        headline: { maxChars: 45, style: 'convite-a-seguir-ou-salvar' },
        cta: { maxChars: 25, style: 'acao-de-baixo-comprometimento' },
        caption: { maxChars: 60, style: 'onde-encontrar-mais' },
      },
      visualNotes: 'Tom convidativo, autoridade construída.',
    },
  ],
}

// ============================================
// PASSO A PASSO — tutorial / how-to numerado (save-driven, tutorial real)
// ============================================
export const stepByStepTemplate: CarouselTemplate = {
  id: 'step-by-step',
  name: 'Passo a passo',
  description: 'Para tutoriais e processos ("Como fazer X em N passos"). Cada slide é um passo claro — o público salva pra executar depois.',
  slideCount: 7,
  recommendedFor: ['awareness', 'consideration'],
  bestFor: ['tutoriais', 'passo a passo', 'processos', 'como fazer'],
  slides: [
    {
      index: 1, type: 'cover', purpose: 'Hook com a PROMESSA do resultado — "como fazer X (em N passos)"',
      layout: 'centered-headline', emotionalBeat: 'curiosity',
      requiredElements: ['headline'], optionalElements: ['eyebrow', 'subheadline'],
      copyConstraints: {
        eyebrow: { maxChars: 24, style: 'tutorial-ou-passo-a-passo' },
        headline: { maxChars: 50, style: 'como-fazer-X-mais-numero-de-passos' },
        subheadline: { maxChars: 60, style: 'o-resultado-que-vai-alcancar' },
      },
      visualNotes: 'Promessa clara do resultado final.',
    },
    {
      index: 2, type: 'problem', purpose: 'O que você vai precisar / por que esse processo — contexto rápido',
      layout: 'headline-subheadline', emotionalBeat: 'hope',
      requiredElements: ['headline', 'body'],
      copyConstraints: {
        headline: { maxChars: 40, style: 'antes-de-comecar' },
        body: { maxChars: 140, style: 'pre-requisito-ou-contexto' },
      },
      visualNotes: 'Prepara o terreno, sem assustar.',
    },
    {
      index: 3, type: 'features', purpose: 'Passo 1', layout: 'headline-subheadline', emotionalBeat: 'hope',
      requiredElements: ['headline', 'body'],
      copyConstraints: {
        headline: { maxChars: 44, style: 'PASSO-1-mais-acao' },
        body: { maxChars: 140, style: 'como-executar-o-passo' },
      },
      visualNotes: 'Número do passo dominante. Sequência visual clara.',
    },
    {
      index: 4, type: 'features', purpose: 'Passo 2', layout: 'headline-subheadline', emotionalBeat: 'excitement',
      requiredElements: ['headline', 'body'],
      copyConstraints: {
        headline: { maxChars: 44, style: 'PASSO-2-mais-acao' },
        body: { maxChars: 140, style: 'como-executar-o-passo' },
      },
      visualNotes: 'Consistente com o passo 1.',
    },
    {
      index: 5, type: 'features', purpose: 'Passo 3', layout: 'headline-subheadline', emotionalBeat: 'empowerment',
      requiredElements: ['headline', 'body'],
      copyConstraints: {
        headline: { maxChars: 44, style: 'PASSO-3-mais-acao' },
        body: { maxChars: 140, style: 'como-executar-o-passo' },
      },
      visualNotes: 'Último passo — o que fecha o processo.',
    },
    {
      index: 6, type: 'benefits', purpose: 'O resultado — o que você tem ao terminar (prova do valor)',
      layout: 'stat-highlight', emotionalBeat: 'trust',
      requiredElements: ['headline', 'body'], optionalElements: ['stat'],
      copyConstraints: {
        headline: { maxChars: 40, style: 'o-resultado-final' },
        body: { maxChars: 120, style: 'o-que-voce-conquistou' },
        stat: { maxChars: 6, style: 'numero-do-resultado-se-houver' },
      },
      visualNotes: 'Mostra o "depois" do processo.',
    },
    {
      index: 7, type: 'cta', purpose: 'CTA — salvar pra executar / seguir pra mais tutoriais',
      layout: 'cta-focused', emotionalBeat: 'empowerment',
      requiredElements: ['headline', 'cta'], optionalElements: ['caption'],
      copyConstraints: {
        headline: { maxChars: 45, style: 'convite-a-salvar-e-executar' },
        cta: { maxChars: 25, style: 'acao-clara' },
        caption: { maxChars: 60, style: 'onde-aprender-mais' },
      },
      visualNotes: 'CTA orientado a save (executar depois). Marca presente.',
    },
  ],
}

// ============================================
// BASTIDORES / STORYTELLING — conexão e awareness (behind-the-scenes)
// ============================================
export const storytellingTemplate: CarouselTemplate = {
  id: 'storytelling',
  name: 'Bastidores / História',
  description: 'Para narrativa e bastidores ("como chegamos aqui", "a história por trás"). Constrói conexão e marca — o conteúdo que humaniza.',
  slideCount: 6,
  recommendedFor: ['awareness'],
  bestFor: ['bastidores', 'storytelling', 'jornada da marca', 'conexão'],
  slides: [
    {
      index: 1, type: 'cover', purpose: 'Hook narrativo — abre um loop ("o dia em que…", "ninguém viu isso")',
      layout: 'centered-headline', emotionalBeat: 'curiosity',
      requiredElements: ['headline'], optionalElements: ['eyebrow'],
      copyConstraints: {
        eyebrow: { maxChars: 24, style: 'bastidores-ou-historia' },
        headline: { maxChars: 56, style: 'abertura-narrativa-que-cria-loop' },
      },
      visualNotes: 'Imagem real/bastidor se houver (slot de imagem). Tom íntimo.',
    },
    {
      index: 2, type: 'problem', purpose: 'O contexto — onde tudo começou (o ponto de partida da história)',
      layout: 'headline-subheadline', emotionalBeat: 'curiosity',
      requiredElements: ['headline', 'body'],
      copyConstraints: {
        headline: { maxChars: 48, style: 'o-comeco-da-historia' },
        body: { maxChars: 140, style: 'o-ponto-de-partida-com-detalhe-real' },
      },
      visualNotes: 'Narrativa pessoal, específica.',
    },
    {
      index: 3, type: 'agitation', purpose: 'O conflito — o obstáculo/momento difícil (a tensão da história)',
      layout: 'headline-subheadline', emotionalBeat: 'frustration',
      requiredElements: ['headline', 'body'],
      copyConstraints: {
        headline: { maxChars: 48, style: 'o-obstaculo-ou-virada' },
        body: { maxChars: 140, style: 'o-momento-de-tensao-real' },
      },
      visualNotes: 'O vale da narrativa — onde a conexão se aprofunda.',
    },
    {
      index: 4, type: 'solution', purpose: 'A virada — o que mudou / a decisão / o aprendizado',
      layout: 'headline-subheadline', emotionalBeat: 'hope',
      requiredElements: ['headline', 'body'],
      copyConstraints: {
        headline: { maxChars: 48, style: 'a-virada-ou-o-aprendizado' },
        body: { maxChars: 140, style: 'o-que-mudou-e-por-que' },
      },
      visualNotes: 'A retomada — energia positiva.',
    },
    {
      index: 5, type: 'benefits', purpose: 'A lição — o que isso ensina pro público (o valor universal da história)',
      layout: 'headline-subheadline', emotionalBeat: 'trust',
      requiredElements: ['headline', 'body'],
      copyConstraints: {
        headline: { maxChars: 40, style: 'a-licao-pro-publico' },
        body: { maxChars: 140, style: 'o-aprendizado-aplicavel' },
      },
      visualNotes: 'Conecta a história pessoal ao público.',
    },
    {
      index: 6, type: 'cta', purpose: 'CTA suave — comentar/seguir pra acompanhar a jornada',
      layout: 'cta-focused', emotionalBeat: 'empowerment',
      requiredElements: ['headline', 'cta'],
      copyConstraints: {
        headline: { maxChars: 45, style: 'convite-a-acompanhar-ou-comentar' },
        cta: { maxChars: 25, style: 'acao-de-conexao-nao-venda' },
      },
      visualNotes: 'CTA de conexão (seguir/comentar), não venda. Marca presente, tom caloroso.',
    },
  ],
}

/** Os 5 arquétipos v2 (dramaturgia-driven), registrados junto dos 4 built-in originais. */
export const ARCHETYPES_V2: CarouselTemplate[] = [
  listicleTemplate,
  comparisonTemplate,
  mythBustingTemplate,
  stepByStepTemplate,
  storytellingTemplate,
]
