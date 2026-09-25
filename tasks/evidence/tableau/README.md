# Evidencia Tableau

Cada subdirectorio es una corrida del discovery. Los JSON son metadatos sanitizados y están
destinados a quedar versionados; los CSV/XLSX crudos viven en `.local/tableau/`, que está ignorado
por Git porque pueden contener nombres, identificadores y revenue de la cliente.

La corrida más reciente completa es `2026-08-17T20-57-22-536Z`. Incluye:

- inventario de 18 workbooks, 44 vistas por workbook y 86 vistas de sitio;
- `Revenue detailed` (`0886ff29-117e-4e3f-b11a-6dafde449803`) en CSV y crosstab;
- `Revenue detailed (SourceID)` (`5af593e6-1a3a-4661-b10b-26467ba4e287`) en CSV y crosstab;
- resultado sanitizado de filtros y metadata de signin/signout, sin PAT ni token temporal.

El resultado funcional está documentado en `tasks/tableau-api-etl-plan.md`: la expansión de
`ID Trusted User` que se ve en la UI no aparece en los exports REST; la vista SourceID devuelve
datos semanales, no una fila por hora.
