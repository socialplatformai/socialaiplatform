/**
 * Carousel Templates
 * Social AI Platform — portado do branding-os.
 *
 * Templates são a fundação da consistência.
 * Cada template define EXATAMENTE a estrutura do carousel.
 */

import type { CarouselTemplate } from '@/types/pipeline'
import {
  listicleTemplate, comparisonTemplate, mythBustingTemplate,
  stepByStepTemplate, storytellingTemplate,
} from './archetypes-v2'

// ============================================
// TEMPLATE 1: PRODUCT LAUNCH
// ============================================

export const productLaunchTemplate: CarouselTemplate = {
  id: 'product-launch',
  name: 'Product Launch',
  description: 'Para lançamentos de produtos, cursos e ofertas. Estrutura PAS (Problem-Agitation-Solution) com foco em conversão.',
  slideCount: 8,
  recommendedFor: ['conversion', 'awareness'],
  bestFor: ['product launches', 'course promotions', 'service offerings', 'Black Friday'],

  slides: [
    {
      index: 1,
      type: 'cover',
      purpose: 'Hook - capturar atenção imediatamente com pergunta provocativa ou estatística impactante',
      layout: 'centered-headline',
      emotionalBeat: 'curiosity',
      requiredElements: ['headline'],
      optionalElements: ['caption'],
      copyConstraints: {
        headline: {
          maxChars: 60,
          style: 'pergunta-provocativa-ou-afirmacao-bold'
        },
        caption: {
          maxChars: 40,
          style: 'swipe-hint'
        }
      },
      visualNotes: 'Background escuro, headline em cor clara com peso bold. Máximo impacto visual.'
    },
    {
      index: 2,
      type: 'problem',
      purpose: 'Apresentar a dor principal do público com estatística ou fato impactante',
      layout: 'stat-highlight',
      emotionalBeat: 'pain',
      requiredElements: ['stat', 'statContext'],
      optionalElements: ['body'],
      copyConstraints: {
        stat: {
          maxChars: 20,
          style: 'numero-impactante-com-unidade'
        },
        statContext: {
          maxChars: 80,
          style: 'explicacao-do-numero'
        },
        body: {
          maxChars: 100,
          style: 'contexto-adicional'
        }
      },
      visualNotes: 'Número grande centralizado, contexto abaixo em fonte menor.'
    },
    {
      index: 3,
      type: 'agitation',
      purpose: 'Amplificar as consequências do problema para criar urgência de resolução',
      layout: 'bullet-points',
      emotionalBeat: 'frustration',
      requiredElements: ['headline', 'bullets'],
      copyConstraints: {
        headline: {
          maxChars: 50,
          style: 'consequencia-do-problema'
        },
        bullets: {
          count: 3,
          maxChars: 60,
          style: 'dor-especifica'
        }
      },
      visualNotes: 'Lista visual com ícones ou checkmarks negativos. Tom mais pesado.'
    },
    {
      index: 4,
      type: 'solution',
      purpose: 'Revelar a solução como a resposta para o problema apresentado',
      layout: 'headline-subheadline',
      emotionalBeat: 'hope',
      requiredElements: ['headline', 'subheadline'],
      optionalElements: ['body'],
      copyConstraints: {
        headline: {
          maxChars: 40,
          style: 'revelacao-da-solucao'
        },
        subheadline: {
          maxChars: 80,
          style: 'proposta-de-valor-principal'
        },
        body: {
          maxChars: 120,
          style: 'breve-descricao'
        }
      },
      visualNotes: 'Transição visual (cor de fundo pode mudar para mais esperançosa). Logo pode aparecer.'
    },
    {
      index: 5,
      type: 'benefits',
      purpose: 'Mostrar os 3 principais benefícios/resultados que o cliente vai ter',
      layout: 'icon-grid',
      emotionalBeat: 'excitement',
      requiredElements: ['headline', 'bullets'],
      copyConstraints: {
        headline: {
          maxChars: 35,
          style: 'o-que-voce-ganha'
        },
        bullets: {
          count: 3,
          maxChars: 50,
          style: 'beneficio-orientado-resultado'
        }
      },
      visualNotes: 'Grid de 3 items com ícones representativos. Cor accent pode ser usada.'
    },
    {
      index: 6,
      type: 'social-proof',
      purpose: 'Provar que a solução funciona através de depoimento ou resultado',
      layout: 'testimonial',
      emotionalBeat: 'trust',
      requiredElements: ['quote', 'attribution'],
      optionalElements: ['stat'],
      copyConstraints: {
        quote: {
          maxChars: 150,
          style: 'depoimento-focado-em-resultado'
        },
        attribution: {
          maxChars: 40,
          style: 'nome-cargo-ou-contexto'
        },
        stat: {
          maxChars: 30,
          style: 'resultado-numerico'
        }
      },
      visualNotes: 'Aspas visuais, foto do cliente se disponível. Tom mais pessoal.'
    },
    {
      index: 7,
      type: 'offer',
      purpose: 'Apresentar a oferta com clareza e criar senso de urgência',
      layout: 'offer-box',
      emotionalBeat: 'urgency',
      requiredElements: ['headline', 'body', 'urgency'],
      copyConstraints: {
        headline: {
          maxChars: 35,
          style: 'headline-da-oferta'
        },
        body: {
          maxChars: 100,
          style: 'detalhes-da-oferta-preco'
        },
        urgency: {
          maxChars: 50,
          style: 'escassez-tempo-ou-quantidade'
        }
      },
      visualNotes: 'Box destacado, cor accent para urgência. Números claros.'
    },
    {
      index: 8,
      type: 'cta',
      purpose: 'Call to action final claro e direto',
      layout: 'cta-focused',
      emotionalBeat: 'empowerment',
      requiredElements: ['headline', 'cta', 'caption'],
      copyConstraints: {
        headline: {
          maxChars: 45,
          style: 'frase-de-acao-ou-transformacao'
        },
        cta: {
          maxChars: 25,
          style: 'texto-do-botao-acao-clara'
        },
        caption: {
          maxChars: 60,
          style: 'instrucao-do-proximo-passo'
        }
      },
      visualNotes: 'CTA como elemento central. Alto contraste. Cor primária no botão.'
    }
  ]
}

// ============================================
// TEMPLATE 2: EDUCATIONAL / HOW-TO
// ============================================

export const educationalTemplate: CarouselTemplate = {
  id: 'educational',
  name: 'Educational / How-To',
  description: 'Para conteúdo educacional, tutoriais e dicas. Estrutura que ensina algo valioso antes de vender.',
  slideCount: 7,
  recommendedFor: ['awareness', 'consideration'],
  bestFor: ['tips and tricks', 'tutorials', 'how-to guides', 'educational content'],

  slides: [
    {
      index: 1,
      type: 'cover',
      purpose: 'Hook educacional - prometer aprendizado valioso',
      layout: 'centered-headline',
      emotionalBeat: 'curiosity',
      requiredElements: ['headline'],
      optionalElements: ['subheadline'],
      copyConstraints: {
        headline: {
          maxChars: 50,
          style: 'numero-dicas-ou-passos-ou-segredo'
        },
        subheadline: {
          maxChars: 60,
          style: 'beneficio-de-aprender-isso'
        }
      },
      visualNotes: 'Clean, profissional. Número destacado se for listicle.'
    },
    {
      index: 2,
      type: 'problem',
      purpose: 'Contextualizar por que esse conhecimento importa',
      layout: 'headline-subheadline',
      emotionalBeat: 'pain',
      requiredElements: ['headline', 'body'],
      copyConstraints: {
        headline: {
          maxChars: 45,
          style: 'o-problema-que-isso-resolve'
        },
        body: {
          maxChars: 120,
          style: 'contexto-e-consequencias'
        }
      },
      visualNotes: 'Tom mais sério, preparando para o conteúdo educacional.'
    },
    {
      index: 3,
      type: 'features',
      purpose: 'Dica/Passo 1 - primeiro insight valioso',
      layout: 'headline-subheadline',
      emotionalBeat: 'hope',
      requiredElements: ['headline', 'body'],
      optionalElements: ['caption'],
      copyConstraints: {
        headline: {
          maxChars: 40,
          style: 'numero-mais-titulo-da-dica'
        },
        body: {
          maxChars: 150,
          style: 'explicacao-pratica'
        },
        caption: {
          maxChars: 50,
          style: 'dica-extra-ou-exemplo'
        }
      },
      visualNotes: 'Número do passo destacado. Ícone representativo opcional.'
    },
    {
      index: 4,
      type: 'features',
      purpose: 'Dica/Passo 2 - segundo insight valioso',
      layout: 'headline-subheadline',
      emotionalBeat: 'excitement',
      requiredElements: ['headline', 'body'],
      optionalElements: ['caption'],
      copyConstraints: {
        headline: {
          maxChars: 40,
          style: 'numero-mais-titulo-da-dica'
        },
        body: {
          maxChars: 150,
          style: 'explicacao-pratica'
        },
        caption: {
          maxChars: 50,
          style: 'dica-extra-ou-exemplo'
        }
      },
      visualNotes: 'Consistente com slide anterior. Variação sutil de cor.'
    },
    {
      index: 5,
      type: 'features',
      purpose: 'Dica/Passo 3 - terceiro insight valioso (o mais poderoso)',
      layout: 'headline-subheadline',
      emotionalBeat: 'empowerment',
      requiredElements: ['headline', 'body'],
      optionalElements: ['caption'],
      copyConstraints: {
        headline: {
          maxChars: 40,
          style: 'numero-mais-titulo-da-dica'
        },
        body: {
          maxChars: 150,
          style: 'explicacao-pratica'
        },
        caption: {
          maxChars: 50,
          style: 'dica-extra-ou-exemplo'
        }
      },
      visualNotes: 'Pode ter destaque extra por ser a dica principal.'
    },
    {
      index: 6,
      type: 'solution',
      purpose: 'Conectar o aprendizado com a solução/produto',
      layout: 'headline-subheadline',
      emotionalBeat: 'trust',
      requiredElements: ['headline', 'body'],
      copyConstraints: {
        headline: {
          maxChars: 45,
          style: 'quer-ir-mais-fundo'
        },
        body: {
          maxChars: 120,
          style: 'como-produto-ajuda-nisso'
        }
      },
      visualNotes: 'Transição suave para o pitch. Não agressivo.'
    },
    {
      index: 7,
      type: 'cta',
      purpose: 'CTA leve e orientado a valor',
      layout: 'cta-focused',
      emotionalBeat: 'empowerment',
      requiredElements: ['headline', 'cta'],
      optionalElements: ['caption'],
      copyConstraints: {
        headline: {
          maxChars: 45,
          style: 'convite-para-aprender-mais'
        },
        cta: {
          maxChars: 25,
          style: 'acao-de-baixo-comprometimento'
        },
        caption: {
          maxChars: 60,
          style: 'onde-encontrar'
        }
      },
      visualNotes: 'Tom mais convidativo que urgente. Educacional até o fim.'
    }
  ]
}

// ============================================
// TEMPLATE 3: SOCIAL PROOF / TESTIMONIAL
// ============================================

export const socialProofTemplate: CarouselTemplate = {
  id: 'social-proof',
  name: 'Social Proof',
  description: 'Para mostrar resultados de clientes e construir confiança. Deixa os clientes falarem.',
  slideCount: 6,
  recommendedFor: ['consideration', 'conversion'],
  bestFor: ['testimonials', 'case studies', 'results showcase', 'trust building'],

  slides: [
    {
      index: 1,
      type: 'cover',
      purpose: 'Hook com resultado impressionante ou pergunta sobre resultados',
      layout: 'stat-highlight',
      emotionalBeat: 'curiosity',
      requiredElements: ['headline'],
      optionalElements: ['stat'],
      copyConstraints: {
        headline: {
          maxChars: 50,
          style: 'resultado-ou-pergunta-sobre-resultados'
        },
        stat: {
          maxChars: 25,
          style: 'numero-de-clientes-ou-resultado'
        }
      },
      visualNotes: 'Impactante mas credível. Não exagerado.'
    },
    {
      index: 2,
      type: 'social-proof',
      purpose: 'Primeiro depoimento - o mais forte/credível',
      layout: 'testimonial',
      emotionalBeat: 'trust',
      requiredElements: ['quote', 'attribution'],
      copyConstraints: {
        quote: {
          maxChars: 180,
          style: 'depoimento-com-resultado-especifico'
        },
        attribution: {
          maxChars: 50,
          style: 'nome-cargo-empresa'
        }
      },
      visualNotes: 'Foto do cliente se disponível. Aspas visuais.'
    },
    {
      index: 3,
      type: 'social-proof',
      purpose: 'Segundo depoimento - perspectiva diferente',
      layout: 'testimonial',
      emotionalBeat: 'trust',
      requiredElements: ['quote', 'attribution'],
      copyConstraints: {
        quote: {
          maxChars: 180,
          style: 'depoimento-angulo-diferente'
        },
        attribution: {
          maxChars: 50,
          style: 'nome-cargo-empresa'
        }
      },
      visualNotes: 'Variação visual sutil do anterior.'
    },
    {
      index: 4,
      type: 'stats',
      purpose: 'Resultados agregados / números impressionantes',
      layout: 'icon-grid',
      emotionalBeat: 'excitement',
      requiredElements: ['bullets'],
      optionalElements: ['headline'],
      copyConstraints: {
        headline: {
          maxChars: 35,
          style: 'resultados-em-numeros'
        },
        bullets: {
          count: 3,
          maxChars: 40,
          style: 'metrica-mais-numero'
        }
      },
      visualNotes: 'Grid de métricas. Números grandes, contexto menor.'
    },
    {
      index: 5,
      type: 'solution',
      purpose: 'O que torna isso possível (produto/método)',
      layout: 'headline-subheadline',
      emotionalBeat: 'hope',
      requiredElements: ['headline', 'body'],
      copyConstraints: {
        headline: {
          maxChars: 40,
          style: 'o-que-eles-usaram'
        },
        body: {
          maxChars: 120,
          style: 'breve-sobre-produto'
        }
      },
      visualNotes: 'Conecta os resultados com a solução.'
    },
    {
      index: 6,
      type: 'cta',
      purpose: 'CTA para se juntar aos resultados',
      layout: 'cta-focused',
      emotionalBeat: 'empowerment',
      requiredElements: ['headline', 'cta'],
      optionalElements: ['caption'],
      copyConstraints: {
        headline: {
          maxChars: 45,
          style: 'convite-para-ser-proximo-caso'
        },
        cta: {
          maxChars: 25,
          style: 'acao-clara'
        },
        caption: {
          maxChars: 50,
          style: 'garantia-ou-facilitador'
        }
      },
      visualNotes: 'CTA confiante. Tom de "você também pode".'
    }
  ]
}

// ============================================
// TEMPLATE 4: ANNOUNCEMENT / NEWS
// ============================================

export const announcementTemplate: CarouselTemplate = {
  id: 'announcement',
  name: 'Announcement',
  description: 'Para anúncios importantes, novidades e atualizações. Direto ao ponto.',
  slideCount: 5,
  recommendedFor: ['awareness'],
  bestFor: ['new features', 'updates', 'news', 'announcements', 'launches'],

  slides: [
    {
      index: 1,
      type: 'cover',
      purpose: 'Hook de novidade - criar expectativa',
      layout: 'centered-headline',
      emotionalBeat: 'curiosity',
      requiredElements: ['headline'],
      optionalElements: ['subheadline'],
      copyConstraints: {
        headline: {
          maxChars: 40,
          style: 'novidade-ou-anuncio'
        },
        subheadline: {
          maxChars: 50,
          style: 'contexto-rapido'
        }
      },
      visualNotes: 'Visual que transmita "novo". Pode usar badge de "NOVO".'
    },
    {
      index: 2,
      type: 'solution',
      purpose: 'O que é a novidade em detalhes',
      layout: 'headline-subheadline',
      emotionalBeat: 'excitement',
      requiredElements: ['headline', 'body'],
      copyConstraints: {
        headline: {
          maxChars: 45,
          style: 'nome-ou-titulo-da-novidade'
        },
        body: {
          maxChars: 150,
          style: 'descricao-clara'
        }
      },
      visualNotes: 'Foco total no que está sendo anunciado.'
    },
    {
      index: 3,
      type: 'benefits',
      purpose: 'Por que isso importa para o público',
      layout: 'bullet-points',
      emotionalBeat: 'hope',
      requiredElements: ['headline', 'bullets'],
      copyConstraints: {
        headline: {
          maxChars: 35,
          style: 'o-que-muda-pra-voce'
        },
        bullets: {
          count: 3,
          maxChars: 50,
          style: 'beneficio-da-novidade'
        }
      },
      visualNotes: 'Lista clara dos benefícios.'
    },
    {
      index: 4,
      type: 'features',
      purpose: 'Detalhes extras ou disponibilidade',
      layout: 'headline-subheadline',
      emotionalBeat: 'excitement',
      requiredElements: ['headline', 'body'],
      optionalElements: ['urgency'],
      copyConstraints: {
        headline: {
          maxChars: 35,
          style: 'quando-ou-como'
        },
        body: {
          maxChars: 100,
          style: 'detalhes-de-acesso'
        },
        urgency: {
          maxChars: 40,
          style: 'data-ou-disponibilidade'
        }
      },
      visualNotes: 'Informações práticas.'
    },
    {
      index: 5,
      type: 'cta',
      purpose: 'Ação para aproveitar a novidade',
      layout: 'cta-focused',
      emotionalBeat: 'empowerment',
      requiredElements: ['headline', 'cta'],
      copyConstraints: {
        headline: {
          maxChars: 40,
          style: 'convite-para-acao'
        },
        cta: {
          maxChars: 25,
          style: 'acao-especifica'
        }
      },
      visualNotes: 'CTA direto e claro.'
    }
  ]
}

// ============================================
// TEMPLATE REGISTRY
// ============================================

export const TEMPLATES: Record<string, CarouselTemplate> = {
  'product-launch': productLaunchTemplate,
  'educational': educationalTemplate,
  'social-proof': socialProofTemplate,
  'announcement': announcementTemplate,
  // v2 dramaturgia-driven (archetypes-v2.ts): os formatos save/send-driven do feed.
  'listicle': listicleTemplate,
  'comparison': comparisonTemplate,
  'myth-busting': mythBustingTemplate,
  'step-by-step': stepByStepTemplate,
  'storytelling': storytellingTemplate,
}

export const TEMPLATE_LIST = Object.values(TEMPLATES)

// ============================================
// TEMPLATE SELECTION LOGIC
// ============================================

interface TemplateSelectionInput {
  objective: 'awareness' | 'consideration' | 'conversion'
  angle: 'transformation' | 'social-proof' | 'urgency' | 'education'
  hasTestimonials: boolean
  isNewProduct: boolean
  contentLength: 'short' | 'medium' | 'long'
}

export function selectBestTemplate(input: TemplateSelectionInput): CarouselTemplate {
  // Lógica de seleção baseada nos inputs

  // Se o ângulo é social-proof e tem depoimentos
  if (input.angle === 'social-proof' && input.hasTestimonials) {
    return socialProofTemplate
  }

  // Se é educacional
  if (input.angle === 'education') {
    return educationalTemplate
  }

  // Se é produto novo ou anúncio
  if (input.isNewProduct && input.objective === 'awareness') {
    return announcementTemplate
  }

  // Se é conversão, usar product-launch
  if (input.objective === 'conversion') {
    return productLaunchTemplate
  }

  // Se é awareness com transformação
  if (input.objective === 'awareness' && input.angle === 'transformation') {
    return productLaunchTemplate
  }

  // Default: educational para consideration, product-launch para resto
  if (input.objective === 'consideration') {
    return educationalTemplate
  }

  return productLaunchTemplate
}

// ============================================
// HELPER: GET TEMPLATE BY ID
// ============================================

export function getTemplateById(id: string): CarouselTemplate | null {
  return TEMPLATES[id] || null
}
