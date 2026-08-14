/**
 * Agent Types
 * Social AI Platform — portado do branding-os.
 * E2: Multi-Agent Engine
 */

// ============================================
// AGENT STATUS & LIFECYCLE
// ============================================

export type AgentStatus =
  | 'idle'
  | 'running'
  | 'complete'
  | 'error'
  | 'waiting'

export type AgentId =
  | 'analyzer'
  | 'strategist'
  | 'copywriter'
  | 'visual-director'
  | 'composer'
  | 'quality-gate'

export interface AgentMetadata {
  id: AgentId
  name: string
  description: string
  icon: string
  color: string
}

export const AGENT_METADATA: Record<AgentId, AgentMetadata> = {
  analyzer: {
    id: 'analyzer',
    name: 'Analyzer',
    description: 'Analyzes input and creates strategic brief',
    icon: 'search',
    color: '#007AFF',
  },
  strategist: {
    id: 'strategist',
    name: 'Strategist',
    description: 'Develops positioning and narrative arc',
    icon: 'chess',
    color: '#5856D6',
  },
  copywriter: {
    id: 'copywriter',
    name: 'Copywriter',
    description: 'Generates brand-aligned copy',
    icon: 'edit',
    color: '#34C759',
  },
  'visual-director': {
    id: 'visual-director',
    name: 'Visual Director',
    description: 'Creates visual specifications',
    icon: 'palette',
    color: '#FF9500',
  },
  composer: {
    id: 'composer',
    name: 'Composer',
    description: 'Composes final assets',
    icon: 'layout',
    color: '#FF2D55',
  },
  'quality-gate': {
    id: 'quality-gate',
    name: 'Quality Gate',
    description: 'Validates brand compliance',
    icon: 'shield-check',
    color: '#C9B298',
  },
}

// ============================================
// AGENT INPUT/OUTPUT SCHEMAS
// ============================================

export interface AgentInput {
  assetType: AssetType
  context: ProductContext
  goal: GenerationGoal
  content: ContentInput
  brandConfig: BrandConfigReference
}

export interface BrandConfigReference {
  visualIdentity: {
    logoUrl: string | null
    colors: Record<string, string>
    fonts: Record<string, string>
  }
  voice: {
    attributes: string[]
    toneGuidelines: string[]
  }
  examples: Array<{
    type: string
    annotation: string
  }>
}

export type AssetType = 'carousel' | 'slide' | 'ad' | 'post'

export interface ProductContext {
  name: string
  description: string
  targetAudience?: string
  keyFeatures: string[]
}

export interface GenerationGoal {
  type: 'awareness' | 'consideration' | 'conversion' | 'retention'
  angle: 'benefit-focused' | 'problem-solution' | 'social-proof' | 'urgency'
  instructions?: string
}

export interface ContentInput {
  text: string
  files?: File[]
  slideCount?: number // 4-10 slides, default 8
}

// ============================================
// ANALYZER AGENT OUTPUT
// ============================================

export interface AnalyzerOutput {
  contentAnalysis: {
    keyMessages: string[]
    themes: string[]
    audienceInsights: string[]
  }
  brandAlignment: {
    score: number // 0-100
    strengths: string[]
    gaps: string[]
  }
  strategicRecommendations: {
    angles: string[]
    hooks: string[]
    positioning: string
  }
  outputSpecification: {
    format: AssetType
    slideCount?: number
    dimensions?: { width: number; height: number }
  }
}

// ============================================
// STRATEGIST AGENT OUTPUT
// ============================================

export interface StrategistOutput {
  coreMessage: {
    primary: string
    supporting: string[]
  }
  narrativeArc: {
    hook: string
    body: string[]
    cta: string
  }
  audiencePositioning: {
    who: string
    why: string
    what: string
  }
  contentPillars: string[]
}

// ============================================
// COPYWRITER AGENT OUTPUT
// ============================================

export interface CopywriterOutput {
  headlines: string[]
  bodyCopy: string[]
  ctas: string[]
  microcopy: {
    captions: string[]
    labels: string[]
  }
  slideContent?: Array<{
    headline: string
    body: string
    cta?: string
  }>
}

// ============================================
// VISUAL DIRECTOR AGENT OUTPUT
// ============================================

export interface VisualDirectorOutput {
  layout: {
    structure: 'grid' | 'centered' | 'asymmetric' | 'split'
    composition: string
    gridSpec?: { columns: number; rows: number; gap: number }
  }
  colorUsage: {
    background: string
    text: string
    accent: string
    cta: string
  }
  typography: {
    headingSize: string
    bodySize: string
    weights: Record<string, number>
  }
  visualElements: {
    icons: string[]
    illustrations: string[]
    photoStyle?: string
  }
  mood: {
    energy: 'calm' | 'moderate' | 'dynamic' | 'intense'
    tone: 'professional' | 'friendly' | 'playful' | 'sophisticated'
    style: string
  }
}

// ============================================
// COMPOSER AGENT OUTPUT
// ============================================

export interface ComposerOutput {
  html: string
  css: string
  assets: {
    images: string[]
    fonts: string[]
  }
  responsive: {
    mobile: string
    desktop: string
  }
  exportFormats: ('png' | 'pdf' | 'html')[]
}

// ============================================
// QUALITY GATE AGENT OUTPUT
// ============================================

export interface QualityGateOutput {
  overallScore: number // 0-100
  passed: boolean
  categories: {
    visual: ComplianceCategory
    voice: ComplianceCategory
    structure: ComplianceCategory
    accessibility: ComplianceCategory
  }
  issues: ComplianceIssue[]
  recommendations: string[]
}

export interface ComplianceCategory {
  score: number
  weight: number
  passed: boolean
  checks: ComplianceCheck[]
}

export interface ComplianceCheck {
  name: string
  passed: boolean
  details?: string
}

export interface ComplianceIssue {
  severity: 'critical' | 'major' | 'minor'
  category: 'visual' | 'voice' | 'structure' | 'accessibility'
  message: string
  suggestion: string
}

// ============================================
// PIPELINE STATE
// ============================================

export interface PipelineState {
  id: string
  status: 'idle' | 'running' | 'complete' | 'error'
  currentAgent: AgentId | null
  progress: number // 0-100
  startedAt: Date | null
  completedAt: Date | null
  error: string | null

  // Agent outputs
  analyzerOutput: AnalyzerOutput | null
  strategistOutput: StrategistOutput | null
  copywriterOutput: CopywriterOutput | null
  visualDirectorOutput: VisualDirectorOutput | null
  composerOutput: ComposerOutput | null
  qualityGateOutput: QualityGateOutput | null
}

export interface AgentStep {
  agentId: AgentId
  status: AgentStatus
  startedAt: Date | null
  completedAt: Date | null
  duration: number | null // ms
  output: unknown | null
  error: string | null
}

// ============================================
// GENERATION HISTORY
// ============================================

export interface GenerationHistoryItem {
  id: string
  createdAt: Date
  input: AgentInput
  pipeline: PipelineState
  finalAsset: ComposerOutput | null
  qualityReport: QualityGateOutput | null
}

// ============================================
// API CONFIGURATION
// ============================================

/**
 * Config efetiva passada ao GeminiAPIClient. A FONTE DA VERDADE de provider/
 * modelo/params é `src/config.ts` (E5.2/ADR-0004); esta interface só carrega o
 * já-resolvido até o client. O antigo campo `model` (union de literais) era um
 * CAMPO FANTASMA — nunca lido por `complete()` — e foi removido para matar o drift.
 * Os modelos agora são explícitos por modalidade (textModel/imageModel).
 */
export interface GeminiAPIConfig {
  apiKey: string
  /** Modelo de texto resolvido (de aiConfig.model.text). */
  textModel: string
  /** Modelo de imagem resolvido (de aiConfig.model.image). */
  imageModel: string
  maxOutputTokens: number
  temperature: number
}

// ============================================
// PIPELINE V2 TYPES (6-Agent Synergy Pipeline)
// ============================================

// V2 Agent IDs (new pipeline with synergy)
export type AgentIdV2 =
  | 'brand-strategist'
  | 'story-architect'
  | 'copywriter-v2'
  | 'visual-compositor'
  | 'quality-validator'
  | 'render-engine'

export interface AgentMetadataV2 {
  id: AgentIdV2
  name: string
  description: string
  icon: string
  color: string
}

export const AGENT_METADATA_V2: Record<AgentIdV2, AgentMetadataV2> = {
  'brand-strategist': {
    id: 'brand-strategist',
    name: 'Brand Strategist',
    description: 'Selects template and defines strategy',
    icon: 'target',
    color: '#5856D6',
  },
  'story-architect': {
    id: 'story-architect',
    name: 'Story Architect',
    description: 'Builds narrative structure slide-by-slide',
    icon: 'document',
    color: '#007AFF',
  },
  'copywriter-v2': {
    id: 'copywriter-v2',
    name: 'Copywriter',
    description: 'Writes copy specific to each slide',
    icon: 'edit',
    color: '#34C759',
  },
  'visual-compositor': {
    id: 'visual-compositor',
    name: 'Visual Compositor',
    description: 'Creates pixel-perfect visual specs',
    icon: 'palette',
    color: '#FF9500',
  },
  'quality-validator': {
    id: 'quality-validator',
    name: 'Quality Validator',
    description: 'Validates brand compliance with technical checks',
    icon: 'shield-check',
    color: '#C9B298',
  },
  'render-engine': {
    id: 'render-engine',
    name: 'Render Engine',
    description: 'Generates HTML/CSS for each slide',
    icon: 'code',
    color: '#FF2D55',
  },
}

// V2 Agent Order for UI display
export const AGENT_ORDER_V2: AgentIdV2[] = [
  'brand-strategist',
  'story-architect',
  'copywriter-v2',
  'visual-compositor',
  'quality-validator',
  'render-engine',
]

// Initial V2 Agent Statuses
export const INITIAL_AGENT_STATUSES_V2: Record<AgentIdV2, AgentStatus> = {
  'brand-strategist': 'idle',
  'story-architect': 'idle',
  'copywriter-v2': 'idle',
  'visual-compositor': 'idle',
  'quality-validator': 'idle',
  'render-engine': 'idle',
}
