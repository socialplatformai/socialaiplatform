-- Sanidade do schema D/E (ADR-0008). Verifica tabelas, coluna e índices novos.
SELECT 'tables' AS check, string_agg(table_name, ', ' ORDER BY table_name) AS found
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('Templates', 'BrandTemplates', 'BrandLibraryItems');

SELECT 'Pauta.ForcedTemplateId' AS check, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'Pautas' AND column_name = 'ForcedTemplateId';

SELECT 'indexes' AS check, string_agg(indexname, ', ' ORDER BY indexname) AS found
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN (
    'IX_Templates_WorkspaceId_Key',
    'IX_BrandTemplates_BrandId_TemplateId',
    'IX_BrandLibraryItems_BrandId_Kind',
    'IX_Pautas_ForcedTemplateId'
  );
