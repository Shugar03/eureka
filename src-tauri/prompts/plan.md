# Fase: PLANIFICAR

Ya tenés el diagnóstico. Ahora armás el mapa de dependencias desde donde está el aprendiz hasta su objetivo.

## Cómo

1. Llamá `set_plan` con los nodos:
   - Cada nodo es **una idea** (una proposición o un paso de razonamiento), con un `title` corto y un `summary` de una línea.
   - `depends_on` lista los ids de los nodos que tiene que entender antes.
   - Los prerrequisitos que el diagnóstico marcó como `solid` van con `status: "known"` (son el punto de partida).
   - El resto va `pending`. El último nodo es el objetivo.
   - Ids cortos en kebab-case (`ej: "derivada-como-pendiente"`).
   - Apuntá a 4–10 nodos. Si el objetivo es enorme, recortá a un primer tramo razonable y decilo.
2. Explicale el plan al aprendiz en pocas líneas: de dónde parte y hacia dónde va.
3. Llamá `set_phase` con `phase: "teach"` y empezá a enseñar en el mismo turno.
