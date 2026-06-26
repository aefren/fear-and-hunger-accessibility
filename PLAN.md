# Plan de accesibilidad — Fear & Hunger 1

## Fase 1 — Base funcional

- [x] **1.1** Descargar `ScreenReaderAccess.js` del repo [craigbrett17/rpgmaker-mv-access](https://github.com/craigbrett17/rpgmaker-mv-access)
- [x] **1.2** Copiar el plugin a `www/js/plugins/`
- [x] **1.3** Registrar el plugin en `www/js/plugins.js` **después** de `YEP_MessageCore` (orden de carga crítico)
- [x] **1.4** Lanzar el juego con NVDA activo y verificar que los diálogos se leen en voz alta. Verificado.
- [x] **1.5** Verificar que el menú principal (opciones, nuevo juego, continuar) se anuncia correctamente. YEP_OptionsCore: ampliado el hook de `Window_Options.select` para leer también el `HelpDesc` de cada opción y categoría (bitmap-only en pantalla); verificado en esta sesión.

## Fase 2 — GabWindow

- [ ] **2.1** Identificar en qué momentos del juego aparece el GabWindow (mensajes flotantes de NPC / sistema)
- [x] **2.2** Escribir hook sobre `Window_Gab.prototype.drawGabText` para capturar el texto y enviarlo a la región `aria-live`. Ya implementado en `ScreenReaderAccess.js` tras guardia `Imported.YEP_GabWindow`.
- [x] **2.3** Verificar que NVDA lee los mensajes flotantes en el dungeon. Confirmado: "An unnatural hunger begins draining your strength..." desapareció solo — es GabWindow, no Window_Message. El hook de `drawGabText` lo capturó correctamente.

## Fase 3 — Menús custom

- [x] **3.1** Hookear `GALV_BustMenu` para que NVDA lea nombres de actores, HP/MP y stats al navegar el menú principal. `Window_MenuStatus` no define `select` propio (hereda de `Window_Selectable`) y GALV navega con `cursorUp/Down` → `this.select()`; se hookea `Window_MenuStatus.prototype.select` para anunciar nombre, nivel, clase, HP, MP y estados (espejo de `drawActorSimpleStatus`). Las etiquetas HP/MP usan `TextManager.hp`/`TextManager.mp` para respetar los nombres del juego (Body/Mind).
- [x] **3.2** Hookear `AltMenuScreen` para que se anuncien las opciones del menú (Objetos, Habilidades, Equipo, Estado, Guardar, Salir). Cubierto por el hook genérico existente `Window_Command.prototype.select`: `AltMenuScreen` solo reordena el layout y `Window_MenuCommand` hereda `select` de `Window_Command`. Verificar con NVDA en 3.5.
- [x] **3.3** Hookear `AltSaveScreen` para que se lean los slots de guardado y su información. `Window_SavefileList` hereda `select` de `Window_Selectable` (no de `Window_Command`), por eso el hook genérico no lo cubría; se hookea `Window_SavefileList.prototype.select` para anunciar número de archivo + título + tiempo de juego (o "Empty"), espejo de `Window_SavefileStatus.drawContents`. Verificado con NVDA.
- [x] **3.4** Pantalla de selección de personaje (New Game, `Map010`): hookear `Game_Picture.prototype.show` para anunciar nombre + descripción de cada clase (Mercenary, Knight, Dark Priest, Outlander). La pantalla es 100% imágenes (`text_<clase>.rpgmvp` en Picture ID 7), sin texto de Window; descripciones transcritas verbatim de las imágenes y mapeadas en el plugin.
- [x] **3.5** Verificar navegación completa de menús sin vista. Cubierto y verificado: síntesis (`YEP_ItemSynthesis` — `Window_SynthesisStatus.prototype.refresh` para el panel de estadísticas y `Window_SynthesisList.prototype.select` para las recetas) y la expansión de nombres abreviados del menú ("Q"/"Sk"/"Eq"/"St" → "Quit"/"Skills"/"Equipment"/"Status") en el hook de `Window_Command.prototype.select`. Pendiente de verificar: pantalla de equipo (`Scene_Equip`) — `Window_EquipSlot.prototype.select` anuncia slot + ítem equipado + descripción; `Window_EquipItem.prototype.select` anuncia ítem + descripción + cambio de atributos (diff de actor temporal espejo de `Window_EquipItem.updateHelp`, params 2..7 = Attack..Luck). El panel de atributos (`Window_EquipStatus`) es solo dibujo y nunca recibe foco (en F&H solo funcionan left/right sobre Equip/Optimize/Clear), así que los 6 atributos actuales se leen a demanda con **Tab** (handler global; funciona en cualquier escena con `actor()`: Equip/Status/Skill). Optimize/Clear ahora anuncian la acción + atributos resultantes (antes solo sonaban, parecían no hacer nada).

## Fase 4 — Combate (OctoBattle)

- [ ] **4.1** `Window_ActorCommand` — anunciar cada comando al navegar (Atacar, Habilidad, Objeto, Defender, Boost, etc.)
- [ ] **4.2** `Window_BattleEnemy` — anunciar nombre del enemigo objetivo al seleccionarlo
- [ ] **4.3** Anuncio de daño y curación — resultado de cada acción (quién atacó, a quién, cuánto daño, si fue crítico)
- [ ] **4.4** Break Shield System — anunciar cuando un escudo se rompe y el estado de aturdimiento que aplica
- [ ] **4.5** Boost Point System — anunciar uso y ganancia de BP al inicio/fin de turno
- [ ] **4.6** Order Turn Battle — leer el orden de turno cuando cambia (quién actúa a continuación)
- [ ] **4.7** Weapon Swap — anunciar el arma equipada al cambiar
- [ ] **4.8** Victory Sequence — leer la pantalla de recompensas al ganar un combate (XP, oro, objetos)
- [ ] **4.9** `Window_BattleStatus` — anunciar HP/estado de los actores cuando cambia durante el combate

## Fase 5 — Navegación por el mapa

- [x] **5.1** Verificar que `WallBump.js` está instalado y funciona (sonido al chocar con paredes). Verificado.
- [x] **5.2** Verificar que `InteractableElementsMenu.js` funciona (hotkey que lista objetos interactuables). La lista ya se lee con NVDA (cubierta por el hook genérico `Window_Command.prototype.select`; se abre con **Shift+I** porque el listener usa el evento `keypress` y el keyCode 73 = 'I' mayúscula). Reescrito el seguimiento sonoro: en vez de modular el BGM (que no sonaba si el mapa no tenía música y solo cambiaba al moverse), ahora `updateBeacon()` reproduce un SE dedicado en bucle como baliza de audio — **pan** = desplazamiento horizontal, **pitch** = vertical (arriba más agudo), **intervalo de repetición + volumen** = distancia (cerca = rápido/fuerte). Usa coords del evento en vivo, cancela al cambiar de mapa y reproduce un SE de llegada al alcanzar el tile. Parámetros nuevos: `Beacon Sound` (def. Cursor1), `Arrival Sound` (def. Bell1). Pendiente de verificación con NVDA en el juego.
- [ ] **5.3** Añadir anuncio de nombre de mapa/área al hacer transición entre mapas
- [ ] **5.4** Evaluar si el sistema de iluminación (`TerraxLighting`) requiere algún anuncio de estado (zona oscura, fuente de luz)

## Fase 6 — Pulido y distribución

- [ ] **6.1** Revisar escenas especiales del juego que usen UI custom no cubierta por las fases anteriores
- [ ] **6.2** Añadir opción en el menú de opciones para activar/desactivar el modo accesibilidad
- [ ] **6.3** Empaquetar todo como mod de [FHMM](https://github.com/mattieFM/FearAndHungerModManager) (archivo `.js` + `.json` de metadatos)
- [ ] **6.4** Publicar en audiogames.net y buscar testers ciegos reales
- [ ] **6.5** Iterar con feedback de testers

## Notas técnicas

- **Región aria-live**: div oculto en el DOM que NVDA/JAWS leen automáticamente. No requiere Tolk.
- **Orden de carga en plugins.js**: nuestro plugin siempre al final, después de YEP_MessageCore y OctoBattle.
- **NW.js / Chromium**: versión del juego ≥ Chromium 69. La técnica aria-live funciona sin actualizar el runtime.
- **Mouse desactivado**: F&H ya es 100% teclado. La navegación es predecible.
