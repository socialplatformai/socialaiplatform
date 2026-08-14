namespace SocialAi.Api.Domain;

public enum Priority { Low = 0, Medium = 1, High = 2 }

public enum ContentType { Post = 0, Carousel = 1, Story = 2 }

/// <summary>Modo de operação resolvido por precedência: Content > Campaign > Workspace.</summary>
public enum ApprovalMode { Manual = 0, Automatic = 1 }

public enum ContentStatus
{
    Draft = 0,
    Generating = 1,
    PendingApproval = 2,
    Approved = 3,
    Rejected = 4,
    Scheduled = 5,
    Published = 6,
    EphemeralPublished = 7, // Stories: expiram 24h, insights não coletáveis depois (AM-6)
    Failed = 8
}

public enum PautaStatus { Backlog = 0, Queued = 1, InProgress = 2, Done = 3, Archived = 4 }

public enum PublishResult { Pending = 0, Success = 1, Error = 2, Skipped = 3 }

public enum PublisherKind { Mock = 0, InstagramGraph = 1 }

/// <summary>Papel do usuário no workspace. 1º usuário do registro = Admin (dono).</summary>
public enum UserRole { Member = 0, Admin = 1 }

/// <summary>Tipo de segredo guardado por workspace (AM-3). Valor cifrado em repouso.</summary>
public enum SecretKind
{
    InstagramToken = 0,
    AiProviderKey = 1,
    ImageProviderKey = 2,
    MetaAppSecret = 3
}

/// <summary>
/// Tipo de item da biblioteca de marca (E1/ADR-0008). Discriminador da tabela
/// BrandLibraryItem. SINCRONIZADO .NET↔TS via scripts/gen-enums.mjs (invariante E0.3):
/// mudar aqui exige rodar o gerador + enums.contract.test.ts.
/// </summary>
public enum LibraryItemKind { Example = 0, Hashtag = 1, Reference = 2 }

/// <summary>
/// Origem de uma PerformanceMetric (C3/DEC-5/ADR-0010). Mock = métrica sintética
/// determinística (sem token IG ou parse falho); Real = parseada de /insights da Graph API.
/// A UI rotula "simulado" quando Source=Mock — honestidade de estado, nunca número falso mudo.
/// SINCRONIZADO .NET↔TS via scripts/gen-enums.mjs (invariante E0.3).
/// </summary>
public enum MetricSource { Mock = 0, Real = 1 }

/// <summary>
/// Recorrência de um ScheduledPost (G5/ADR-0014). None = publica uma vez (comportamento padrão);
/// Daily/Weekly/Monthly = ao despachar, o worker reagenda a PRÓXIMA ocorrência (clone do conteúdo
/// + novo ScheduledPost). SINCRONIZADO .NET↔TS via scripts/gen-enums.mjs (invariante E0.3).
/// </summary>
public enum Frequency { None = 0, Daily = 1, Weekly = 2, Monthly = 3 }

/// <summary>
/// Fase 2 (task 2.1) — estratégia de criativo do robô por workspace. Hybrid = o Creative Director
/// decide por slide (comportamento atual do pipeline); AlwaysPhoto/AlwaysGraphic = força a estratégia.
/// Hoje é config de governança (o painel escreve; o consumo fino no pipeline é evolução — 3.4).
/// SINCRONIZADO .NET↔TS via scripts/gen-enums.mjs (invariante E0.3).
/// </summary>
public enum CreativeStrategyMode { Hybrid = 0, AlwaysPhoto = 1, AlwaysGraphic = 2 }

/// <summary>
/// Fase 2 (task 2.2) — modo de operação do workspace (o "volante"). Manual = tudo pede humano;
/// Assisted = robô gera e agenda mas aprovação é humana; Automatic = robô gera, auto-aprova sob
/// gate de qualidade e publica. Deriva das flags (AutoPostEnabled + DefaultApprovalMode) mas é
/// exposto como um seletor único na UI. SINCRONIZADO .NET↔TS via scripts/gen-enums.mjs.
/// </summary>
public enum OperationMode { Manual = 0, Assisted = 1, Automatic = 2 }
