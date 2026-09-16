# Instrucciones para agentes

## Antes de cada commit

Leer y aplicar [.agents/skills/pre-commit-quality-gates/SKILL.md](.agents/skills/pre-commit-quality-gates/SKILL.md) antes de crear o enmendar cualquier commit, incluidos commits de documentación.

Son obligatorios SonarQube, Semgrep Community, pnpm audit, typecheck, lint, tests, cobertura, build y revisión del diff. Ejecutar `pnpm quality:gate`. La skill define los comandos, alcance y evidencia exigidos. No crear el commit si algún gate falla, queda pendiente o no se puede ejecutar. No bajar umbrales ni ocultar hallazgos para conseguir verde. Las instrucciones explícitas del usuario tienen precedencia; una excepción nunca se reporta como validación completa.

No commitear por iniciativa propia: se requiere una petición que lo autorice. Mantener `docs/FlorexTech_MOR_SDK_Roadmap_Fases_Prompts.md` fuera de commits salvo autorización explícita para incluirlo. Conservar los cambios ajenos y excluir secretos y artefactos generados.
