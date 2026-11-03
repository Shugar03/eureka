# El banco de citas

> 366 citas, una para cada día del año (incluido el 29 de febrero), de más de 140 autores. Viene con la app en `src/data/quotes.json`: no usa red ni modelo.

## Criterios

- **Autor y obra, siempre.** Cada cita dice de qué obra viene (libro y capítulo, carta con fecha, fragmento numerado). Si no se podía señalar la obra, no entró.
- **Nada de atribuciones falsas.** Quedaron afuera las famosas que no tienen fuente («Sé el cambio que quieres ver…», «La locura es hacer lo mismo…», «No estoy de acuerdo con lo que dices…», «Sé tú mismo, los demás puestos ya están ocupados»…). Una prueba automática las rechaza.
- **Traducción libre, y se dice.** Lo que no se escribió en español se tradujo para la app y lleva la marca «traducción libre». Lo escrito en español (Cervantes, Sor Juana, Machado, Martí, Borges…) va en su texto original.
- **Dominio público, sobre todo.** La mayoría son autores clásicos. De autores con derechos vigentes (Borges, Cortázar, García Márquez, Freire, Camus) hay citas breves con su fuente, como derecho de cita.
- **Para estudiantes.** Temas: comienzos, constancia, esfuerzo, calma, coraje, error, curiosidad, estudio, humildad, tiempo, presente, libertad, sentido, amistad, descanso, paciencia, esperanza. Cada mes prefiere algunos (marzo: comienzos; julio: descanso; diciembre: sentido y amistad).

## Verificación

Se contrastaron con fuentes públicas las de origen más dudoso, y se corrigió o descartó lo que no se sostenía:

| Cita | Resultado |
|---|---|
| Machado, «Despacito y buena letra…» | Confirmada: *Proverbios y cantares*, XXIV |
| Machado, «Hoy es siempre todavía» | Confirmada: *Proverbios y cantares*, VIII (y XXXVIII) |
| Machado, «Para dialogar, preguntad primero…» | **Descartada**: no aparece en *Proverbios y cantares* |
| Martí, «Hacer es la mejor manera de decir» | **Descartada**: la redacción varía según la fuente |
| Leonardo, «Quien poco piensa, mucho se equivoca» | Confirmada: Códice H, f. 119 |
| Leonardo, «La sabiduría es hija de la experiencia» | Confirmada: Códice Forster III |
| Leonardo, «Ostinato rigore…» (con mi redacción) | **Descartada** |
| Sor Juana, «…ignoro menos» | Corregida al texto exacto de la *Respuesta a Sor Filotea* |
| Sarmiento, «Bárbaros, las ideas no se matan» | **Corregida**: esa es una versión popular; va la de Sarmiento: «A los hombres se degüella; a las ideas, no» |
| Cajal, «escultor de su propio cerebro» | Confirmada (*Reglas y consejos…*, discurso de 1897) |
| Cajal, «No hay cuestiones agotadas…» | **Descartada**: sin fuente localizada |
| Buffon, «El genio es una gran aptitud para la paciencia» | **Descartada**: sin fuente localizada |
| Edison, «1 % de inspiración…» | Confirmada: *Harper's Monthly* (1932), y Edison la reconoció como suya |
| Franklin, «Puedes demorarte, pero el tiempo no» | Fuente: *El camino a la riqueza* (Almanaque de 1758) |
| Almafuerte, «No te des por vencido…» | Fuente corregida: «¡Piú avanti!», en *Evangélicas* |

Las demás son pasajes muy documentados de las obras citadas. **No hubo una revisión editorial completa**: si alguien encuentra un error, la cita se corrige o se quita en `quotes.json`. La prueba `quotes.test.ts` verifica que haya una por día, que todas tengan autor y obra, que no haya repetidas y que no entren las apócrifas conocidas.

## Cómo agregar o cambiar citas

Editar `src/data/quotes.json`: cada cita tiene `id`, `day` («MM-DD», o `null` para las de reserva), `text`, `author`, `work`, `original` (`true` si el texto es el original en español) y `themes`. `npm run test:unit` avisa si algo queda mal.
