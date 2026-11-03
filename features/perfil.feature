# language: es
# Cubre: AC-66 (docs/spec.md, Fase 8)
# Automatización: tests/e2e/perfil.e2e.ts (web)

Característica: Lo que la app sabe de mí

  Escenario: AC-66 Ver y olvidar el perfil
      Dado que la app anotó una confusión y una preferencia mías
      Cuando abro Ajustes
      Entonces las veo con su origen
      Y puedo olvidar una o todas
