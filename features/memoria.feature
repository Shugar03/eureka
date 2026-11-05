# language: es
# Cubre: AC-195 … AC-200 (docs/spec.md, «Memoria del estudiante»)
# Automatización: tests/e2e/memoria.e2e.ts (web), memdb::tests::* y agent::recall_* (Rust)

Característica: Lo que Eureka sabe de mí, con temas estables y sin contradicciones

  Escenario: AC-195 La memoria vieja pasa sola a la nueva
    Dado que tenía ideas en el grafo, confusiones, preferencias y memorias de sesiones
    Cuando actualizo Eureka
    Entonces todo eso aparece en «Lo que Eureka sabe de vos»
    Y los archivos viejos siguen donde estaban
    Y si la migración se corta, sigue donde quedó sin duplicar nada

  Escenario: AC-196 La misma idea no se repite
    Dado que dos sesiones dijeron que me cuesta «la regla de la cadena» y «las reglas de la cadena»
    Entonces veo una sola observación con las dos evidencias

  Escenario: AC-197 Lo nuevo y verificado gana
    Dado que una sesión vieja anotó que me cuestan los límites
    Cuando después acierto los límites en una práctica
    Entonces queda «Ya lo domina» y la anterior queda reemplazada
    Pero si lo verificado es más viejo que lo nuevo, decide el modelo barato y mientras tanto se ve «se contradice con otra»

  Escenario: AC-198 El profesor busca por raíces y lee de a poco
    Dado que en una sesión me costó la «recta tangente»
    Cuando el profesor busca «tangentes» con recall
    Entonces recibe una vista previa corta con su id
    Y el registro entero solo si lo pide con ese id

  Escenario: AC-199 Corrijo y borro lo que Eureka sabe de mí
    Cuando abro «Mi progreso»
    Entonces veo la memoria por tipo con su evidencia
    Y lo que corrijo queda como verificado y mío, y el proceso de fondo no lo pisa
    Y lo que borro no vuelve con la misma evidencia

  Escenario: AC-200 Exporto para Obsidian
    Cuando toco «Exportar para Obsidian»
    Entonces queda en Descargas una carpeta con una página Markdown por observación y por sesión, con metadatos y enlaces
