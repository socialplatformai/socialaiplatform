// GERADO por scripts/gen-enums.mjs a partir de libs/SocialAi.Core/Domain/Enums.cs.
// NÃO editar à mão. Rode `node scripts/gen-enums.mjs` após mudar o Enums.cs.
// O teste de contrato (lib/enums.contract.test.ts) compara isto com os espelhos da UI.

export const ApprovalMode = {
  Manual: 0,
  Automatic: 1,
} as const;

export const ContentStatus = {
  Draft: 0,
  Generating: 1,
  PendingApproval: 2,
  Approved: 3,
  Rejected: 4,
  Scheduled: 5,
  Published: 6,
  EphemeralPublished: 7,
  Failed: 8,
} as const;

export const ContentType = {
  Post: 0,
  Carousel: 1,
  Story: 2,
} as const;

export const CreativeStrategyMode = {
  Hybrid: 0,
  AlwaysPhoto: 1,
  AlwaysGraphic: 2,
} as const;

export const Frequency = {
  None: 0,
  Daily: 1,
  Weekly: 2,
  Monthly: 3,
} as const;

export const LibraryItemKind = {
  Example: 0,
  Hashtag: 1,
  Reference: 2,
} as const;

export const MetricSource = {
  Mock: 0,
  Real: 1,
} as const;

export const OperationMode = {
  Manual: 0,
  Assisted: 1,
  Automatic: 2,
} as const;

export const PautaStatus = {
  Backlog: 0,
  Queued: 1,
  InProgress: 2,
  Done: 3,
  Archived: 4,
} as const;

export const Priority = {
  Low: 0,
  Medium: 1,
  High: 2,
} as const;

export const PublishResult = {
  Pending: 0,
  Success: 1,
  Error: 2,
  Skipped: 3,
} as const;

export const PublisherKind = {
  Mock: 0,
  InstagramGraph: 1,
} as const;

export const SecretKind = {
  InstagramToken: 0,
  AiProviderKey: 1,
  ImageProviderKey: 2,
  MetaAppSecret: 3,
} as const;

export const UserRole = {
  Member: 0,
  Admin: 1,
} as const;
