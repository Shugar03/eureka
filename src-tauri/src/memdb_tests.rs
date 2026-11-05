use super::*;
use chrono::Duration;

fn db() -> (MemoryDb, PathBuf) {
    let dir = std::env::temp_dir().join(format!("la-memdb-{}", uuid::Uuid::new_v4().simple()));
    (MemoryDb::new(&dir), dir)
}

fn ago(days: i64) -> DateTime<Utc> {
    Utc::now() - Duration::days(days)
}

fn n(kind: Kind, title: &str, source: &str, at: DateTime<Utc>) -> Note {
    Note::new(kind, title, title, source, &format!("Sesión: {source}"), at)
}

#[test]
fn fts5_comes_with_the_bundled_sqlite() {
    // Test 0 (AC-195): the bundled SQLite of rusqlite has FTS5 compiled in.
    let c = Connection::open_in_memory().unwrap();
    c.execute_batch("CREATE VIRTUAL TABLE t USING fts5(x, tokenize = \"unicode61 tokenchars '~'\"); INSERT INTO t VALUES ('derivada ~deri pendiente');").unwrap();
    let hits: i64 = c.query_row("SELECT COUNT(*) FROM t WHERE t MATCH '\"~deri\"'", [], |r| r.get(0)).unwrap();
    assert_eq!(hits, 1, "the ~root token survives the tokenizer");
}

#[test]
fn topics_are_stable_across_plurals_accents_and_word_order() {
    assert_eq!(topic(Kind::LeCuesta, "La derivada"), "concepto:derivada");
    assert_eq!(topic(Kind::LeCuesta, "las DERIVADAS"), topic(Kind::Domina, "la derivada"));
    assert_eq!(topic(Kind::Idea, "La pendiente de la tangente es la derivada"), topic(Kind::Idea, "la derivada es la pendiente de la tangente"));
    assert_ne!(topic(Kind::LeCuesta, "la derivada"), topic(Kind::LeCuesta, "derivada del producto"));
    assert!(topic(Kind::Preferencia, "con ejemplos").starts_with("preferencia:"));
    assert_eq!(fts_query("AND : \"x\""), None, "stopwords and syntax alone make no query");
    assert!(fts_query("derivadas OR").unwrap().contains("\"derivada\""));
}

#[test]
fn saving_the_same_topic_again_updates_instead_of_duplicating() {
    let (db, dir) = db();
    let t = ago(1);
    let c1 = db.note(n(Kind::LeCuesta, "La regla de la cadena", "a", ago(3))).unwrap();
    let c2 = db.note(n(Kind::LeCuesta, "las reglas de la cadena", "b", t)).unwrap();
    let c3 = db.note(n(Kind::LeCuesta, "la regla de la cadena", "b", t - Duration::hours(1))).unwrap();
    assert_eq!((c1.created, c2.merged, c3.merged, c3.created), (1, 1, 0, 0), "same source again is not a new duplicate");
    let all = db.list().unwrap();
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].evidence.len(), 2);
    assert_eq!(all[0].title, "las reglas de la cadena", "the newest wording");
    std::fs::remove_dir_all(dir).ok();
}

#[test]
fn a_contradiction_is_resolved_by_the_rule_or_left_for_the_model() {
    let (db, dir) = db();
    // Same verification: the most recent wins.
    db.note(n(Kind::LeCuesta, "límites", "a", ago(5))).unwrap();
    let c = db.note(n(Kind::Domina, "los límites", "b", ago(1))).unwrap();
    assert_eq!((c.contradictions, c.ambiguous), (1, 0));
    let live = db.list().unwrap();
    assert_eq!(live.iter().map(|o| o.kind).collect::<Vec<_>>(), vec![Kind::Domina]);
    let rels = db.all_relations().unwrap();
    assert_eq!((rels[0].kind.as_str(), rels[0].decided_by.as_str()), ("reemplaza", "regla"));

    // Verified and more recent wins over an older unverified one.
    db.note(n(Kind::Domina, "integrales", "a", ago(5))).unwrap();
    let mut v = n(Kind::Confusion, "integrales", "practice:p", ago(1));
    v.verified = true;
    db.note(v).unwrap();
    assert!(db.list().unwrap().iter().any(|o| o.topic == "concepto:integral" && o.kind == Kind::Confusion));
    assert!(!db.list().unwrap().iter().any(|o| o.topic == "concepto:integral" && o.kind == Kind::Domina));

    // Verified but older against unverified but newer: ambiguous, both stay, flagged.
    let mut old = n(Kind::Domina, "fracciones", "practice:q", ago(9));
    old.verified = true;
    db.note(old).unwrap();
    let c = db.note(n(Kind::LeCuesta, "fracciones", "memory:s", ago(1))).unwrap();
    assert_eq!(c.ambiguous, 1);
    let pend = db.pending_conflicts(10).unwrap();
    assert_eq!(pend.len(), 1);
    assert_eq!((pend[0].0.kind, pend[0].1.kind), (Kind::LeCuesta, Kind::Domina), "newer first");
    assert!(db.list().unwrap().iter().filter(|o| o.topic == "concepto:fraccion").all(|o| o.conflict));
    db.decide(pend[0].0.id, pend[0].1.id, "b", "la práctica es más firme").unwrap();
    assert!(db.pending_conflicts(10).unwrap().is_empty());
    assert_eq!(db.list().unwrap().iter().filter(|o| o.topic == "concepto:fraccion").map(|o| o.kind).collect::<Vec<_>>(), vec![Kind::Domina]);
    std::fs::remove_dir_all(dir).ok();
}

#[test]
fn what_the_student_edits_is_verified_and_never_overwritten() {
    let (db, dir) = db();
    db.note(n(Kind::LeCuesta, "derivadas", "a", ago(2))).unwrap();
    let id = db.list().unwrap()[0].id;
    db.edit(id, "Derivadas", "ya las entiendo", Kind::Domina).unwrap();
    let o = db.get(id).unwrap().unwrap();
    assert!(o.by_student && o.verified && o.kind == Kind::Domina);
    assert_eq!(o.evidence[0].label, "Lo corregiste vos");
    // The background says otherwise later: the student's word stays.
    db.note(n(Kind::Domina, "derivadas", "b", Utc::now())).unwrap();
    assert_eq!(db.get(id).unwrap().unwrap().content, "ya las entiendo");
    db.note(n(Kind::LeCuesta, "derivadas", "c", Utc::now())).unwrap();
    assert_eq!(db.list().unwrap().iter().filter(|o| o.topic == "concepto:derivada").map(|o| o.kind).collect::<Vec<_>>(), vec![Kind::Domina]);
    assert!(db.edit(id, "  ", "", Kind::Domina).is_err());
    std::fs::remove_dir_all(dir).ok();
}

#[test]
fn deleting_leaves_a_tombstone_that_old_evidence_cannot_cross() {
    let (db, dir) = db();
    db.note(n(Kind::Confusion, "Tangente", "a", ago(3))).unwrap();
    let id = db.list().unwrap()[0].id;
    db.delete(id).unwrap();
    assert!(db.list().unwrap().is_empty());
    assert!(db.search("tangente", &[], 5).unwrap().is_empty());
    let c = db.note(n(Kind::Confusion, "tangente", "a", ago(3))).unwrap();
    assert_eq!(c.skipped, 1, "the same old evidence doesn't bring it back");
    let gone = db.overrides().unwrap().1;
    assert_eq!(gone[0].0, "concepto:tangent");
    db.note(n(Kind::Confusion, "tangente", "b", Utc::now() + Duration::seconds(5))).unwrap();
    assert_eq!(db.list().unwrap().len(), 1, "a new session that shows it again does");
    assert_eq!(db.forget_all().unwrap(), 1);
    assert!(db.list().unwrap().is_empty());
    std::fs::remove_dir_all(dir).ok();
}

#[test]
fn forgetting_a_source_removes_only_its_evidence() {
    let (db, dir) = db();
    db.note(n(Kind::Idea, "La derivada es una pendiente", "session:s1", ago(2))).unwrap();
    db.note(n(Kind::Idea, "La derivada es una pendiente", "session:s2", ago(1))).unwrap();
    db.note(n(Kind::Idea, "Un límite es un valor", "session:s1", ago(2))).unwrap();
    assert_eq!(db.forget_source("session:s1", None, Some(&[Kind::Idea])).unwrap(), 2);
    let left = db.list().unwrap();
    assert_eq!(left.len(), 1);
    assert_eq!(left[0].evidence.len(), 1);
    std::fs::remove_dir_all(dir).ok();
}

#[test]
fn search_finds_plurals_roots_and_previews_are_short() {
    let (db, dir) = db();
    db.note(Note::new(Kind::Confusion, "Recta tangente", "cree que la tangente corta la curva en dos puntos y por eso no puede ser horizontal nunca en ningún caso posible", "session:a", "Sesión: Derivadas", ago(1))).unwrap();
    db.note(n(Kind::Idea, "La fotosíntesis produce oxígeno", "session:b", ago(1))).unwrap();
    let hits = db.search("tangentes", &[], 5).unwrap();
    assert_eq!(hits.len(), 1);
    let p = preview(&hits[0]);
    assert!(p.starts_with(&format!("- [M{}] Confusión abierta: «Recta tangente»", hits[0].id)), "{p}");
    assert!(p.ends_with('…') && p.chars().count() < 160, "{p}");
    assert!(db.search("tangentes", &[Kind::Idea], 5).unwrap().is_empty(), "filtered by kind");
    assert!(db.search("AND OR :", &[], 5).unwrap().is_empty(), "no FTS syntax error");
    std::fs::remove_dir_all(dir).ok();
}

#[test]
fn sessions_are_searchable_and_forgetting_one_removes_its_memory() {
    let (db, dir) = db();
    let m = SessionMemory { summary: "Vimos el triángulo equilátero y su altura.".into(), pending: vec!["la demostración".into()], struggled: vec!["la altura".into()], messages: 6, at: ago(1) };
    let c = db.record_session("s1", "geometría", &m).unwrap();
    assert_eq!(c.created, 2, "what was hard and what is pending");
    assert_eq!(db.search_sessions("triángulos equiláteros", "otra", 4).unwrap().len(), 1);
    assert!(db.search_sessions("triángulo", "s1", 4).unwrap().is_empty(), "not the current one");
    db.record_session("s1", "geometría", &m).unwrap();
    assert_eq!(db.list().unwrap().len(), 2, "re-recording doesn't duplicate");
    db.forget_session("s1").unwrap();
    assert!(db.search_sessions("triángulo", "otra", 4).unwrap().is_empty());
    assert!(db.list().unwrap().is_empty());
    std::fs::remove_dir_all(dir).ok();
}

fn ledger_and_profile() -> (Vec<crate::graph::Extraction>, crate::learner::Profile) {
    let p = |k: &str, t: &str| RawProposition { key: k.into(), text: t.into() };
    let src = |id: &str| Source::Session { id: id.into(), title: id.into() };
    let ledger = vec![
        crate::graph::Extraction { source: src("s1"), at: ago(5), propositions: vec![p("a", "La derivada es la pendiente de la tangente"), p("b", "La regla de la cadena deriva funciones compuestas")], chains: vec![RawChain { premises: vec!["a".into()], conclusion: "b".into() }] },
        crate::graph::Extraction { source: src("s2"), at: ago(3), propositions: vec![p("x", "la pendiente de la tangente es la derivada")], chains: vec![] },
        // s3 was forgotten afterwards: its ideas must not come back.
        crate::graph::Extraction { source: src("s3"), at: ago(4), propositions: vec![p("z", "Secreto olvidado")], chains: vec![] },
        crate::graph::Extraction { source: src("s3"), at: ago(2), propositions: vec![], chains: vec![] },
    ];
    let mut profile = crate::learner::Profile::default();
    crate::learner::add_misconception(&mut profile, "Límite", "es el valor en el punto", false, "Sesión: s1");
    crate::learner::add_preference(&mut profile, "con ejemplos numéricos", "Sesión: s1");
    (ledger, profile)
}

#[test]
fn migration_follows_the_fold_is_idempotent_and_resumable() {
    let (db, dir) = db();
    let (ledger, profile) = ledger_and_profile();
    let mut s = crate::session::Session::new_chat("charla");
    s.memory = Some(SessionMemory { summary: "Vimos límites.".into(), pending: vec![], struggled: vec!["límites laterales".into()], messages: 4, at: ago(1) });
    let mut forgotten = crate::session::Session::new_chat("olvidada");
    forgotten.memory = Some(SessionMemory::forgotten(4));
    let sessions = vec![s, forgotten];

    // A cut run: only the ledger got in.
    db.migrate(&ledger, &[], &crate::learner::Profile::default()).unwrap();
    let first = db.migrate(&ledger, &sessions, &profile).unwrap();
    assert_eq!(first.created, 3, "the profile and the session memory: {first:?}");
    let again = db.migrate(&ledger, &sessions, &profile).unwrap();
    assert_eq!(again, Counts::default(), "a second run adds nothing");
    let all = db.list().unwrap();
    let ideas: Vec<&Observation> = all.iter().filter(|o| o.kind == Kind::Idea).collect();
    assert_eq!(ideas.len(), 2, "the repeated idea is one, with two sources");
    assert!(ideas.iter().any(|o| o.evidence.len() == 2));
    assert!(!all.iter().any(|o| o.title.contains("Secreto")), "a forgotten source stays forgotten");
    assert_eq!(db.all_relations().unwrap().iter().filter(|r| r.kind == "prerrequisito").count(), 1);
    assert_eq!(db.sessions().unwrap().len(), 1, "a forgotten memory isn't migrated");
    std::fs::remove_dir_all(dir).ok();
}

#[test]
fn hygiene_sets_reviews_and_joins_evident_duplicates() {
    let (db, dir) = db();
    db.note(n(Kind::Idea, "La derivada mide el cambio instantáneo de una función", "session:a", ago(4))).unwrap();
    db.note(n(Kind::Idea, "La derivada mide el cambio instantáneo de la función continua", "session:b", ago(2))).unwrap();
    db.note(n(Kind::LeCuesta, "límites", "a", ago(2))).unwrap();
    assert!(db.hygiene(Utc::now()).unwrap() >= 2);
    let live = db.list().unwrap();
    assert_eq!(live.iter().filter(|o| o.kind == Kind::Idea).count(), 1);
    assert_eq!(live.iter().find(|o| o.kind == Kind::Idea).unwrap().evidence.len(), 2);
    assert!(live.iter().find(|o| o.kind == Kind::LeCuesta).unwrap().due.is_some());
    std::fs::remove_dir_all(dir).ok();
}

#[test]
fn export_writes_linked_pages_with_frontmatter() {
    let (db, dir) = db();
    let (ledger, profile) = ledger_and_profile();
    db.migrate(&ledger, &[], &profile).unwrap();
    // The session first: recording it again replaces what its memory said.
    db.record_session("s1", "Derivadas: repaso", &SessionMemory { summary: "Vimos derivadas.".into(), pending: vec![], struggled: vec![], messages: 4, at: ago(1) }).unwrap();
    db.note(Note::new(Kind::LeCuesta, "Límite: \"lateral\"", "x", "memory:s1", "Sesión: s1", ago(1))).unwrap();
    let out = dir.join("export");
    let pages = db.export_okf(&out).unwrap();
    assert!(pages >= 6);
    let index = std::fs::read_to_string(out.join("Inicio.md")).unwrap();
    assert!(index.starts_with("---\n") && index.contains("[[la-pendiente-de-la-tangente-es-la-derivada|"));
    let cadena = std::fs::read_to_string(out.join("Ideas").join("la-regla-de-la-cadena-deriva-funciones-compuestas.md")).unwrap();
    assert!(cadena.contains("type: \"idea\"") && cadena.contains("Se apoya en [[la-pendiente-de-la-tangente-es-la-derivada]]"), "{cadena}");
    let hard = std::fs::read_to_string(out.join("Le cuesta").join("limite-lateral.md")).unwrap();
    assert!(hard.contains("title: \"Límite: \\\"lateral\\\"\""), "quotes escaped: {hard}");
    assert!(hard.contains("[[sesion-derivadas-repaso]]"), "evidence links to its session");
    assert!(out.join("Sesiones").join("sesion-derivadas-repaso.md").is_file());
    assert_eq!(okf::slug("Tema: a/b?"), "tema-a-b");
    std::fs::remove_dir_all(dir).ok();
}

/// The migration on a COPY of real data (never the live folder): counts only.
/// `EUREKA_MEM_MIGRATE_DIR=D:/dev-cache/mem-data-copy cargo test --lib real_data_migration -- --ignored --nocapture`
#[test]
#[ignore]
fn real_data_migration() {
    let dir = PathBuf::from(std::env::var("EUREKA_MEM_MIGRATE_DIR").expect("EUREKA_MEM_MIGRATE_DIR"));
    assert!(!dir.to_string_lossy().contains("AppData"), "only a copy");
    let st = crate::AppState::new(dir.clone());
    let ledger = st.graph.ledger();
    let props_before: usize = crate::graph::latest(&ledger).iter().map(|e| e.propositions.len()).sum();
    let t = std::time::Instant::now();
    let c = crate::memdb::migrate(&st).unwrap();
    let ms = t.elapsed().as_millis();
    let again = crate::memdb::migrate(&st).unwrap();
    let (obs, topics, open) = st.memdb.stats().unwrap();
    let by_kind: HashMap<&str, usize> = st.memdb.list().unwrap().iter().fold(HashMap::new(), |mut m, o| {
        *m.entry(o.kind.as_str()).or_default() += 1;
        m
    });
    let size = std::fs::metadata(dir.join("memory").join("memoria.sqlite")).map(|m| m.len()).unwrap_or(0);
    println!("propositions in the graph (latest per source): {props_before}");
    println!("first run: {c:?} in {ms} ms; second run: {again:?}");
    println!("live observations {obs}, topics {topics}, open contradictions {open}, by kind {by_kind:?}, db {size} bytes");
    assert_eq!(again.created + again.merged, 0);
}

/// Plan section 8, measured on scripted sessions: ideas and statuses repeated
/// across sessions and contradictions, before (the old files keep every entry
/// unless the normalized text is identical) and after (this store).
#[test]
fn measure_duplicates_and_contradictions_on_scripted_sessions() {
    use Kind::*;
    // (concept, kind, title, session, days ago, verified)
    let script: &[(&str, Kind, &str, &str, i64, bool)] = &[
        ("cadena", LeCuesta, "la regla de la cadena", "s1", 10, false),
        ("cadena", LeCuesta, "las reglas de la cadena", "s2", 8, false),
        ("cadena", Domina, "Regla de la cadena", "practica", 3, true),
        ("derivada", Confusion, "La derivada", "s1", 10, false),
        ("derivada", Confusion, "las derivadas", "s3", 6, false),
        ("derivada", Domina, "Derivadas", "s4", 2, false),
        ("limite", Domina, "Límites", "practica", 9, true),
        ("limite", LeCuesta, "los límites", "s5", 1, false),
        ("fraccion", Pendiente, "las fracciones", "s2", 8, false),
        ("fraccion", Pendiente, "Fracciones", "s4", 2, false),
        ("ejemplos", Preferencia, "con ejemplos numéricos", "s1", 10, false),
        ("ejemplos", Preferencia, "Con ejemplos numéricos.", "s2", 8, false),
        ("ejemplos", Preferencia, "con un ejemplo numérico", "s5", 1, false),
        ("tangente", Idea, "La derivada es la pendiente de la recta tangente", "s1", 10, false),
        ("tangente", Idea, "la pendiente de la recta tangente es la derivada", "s3", 6, false),
        ("tangente", Idea, "La derivada es la pendiente de la recta tangente.", "s4", 2, false),
        ("limite-idea", Idea, "Un límite describe a qué valor se acerca una función", "s2", 8, false),
        ("cadena-idea", Idea, "La regla de la cadena deriva funciones compuestas", "s1", 10, false),
        ("cadena-idea", Idea, "Las reglas de la cadena derivan funciones compuestas", "s5", 1, false),
    ];
    let positive = |k: Kind| k == Domina;
    let negative = |k: Kind| matches!(k, LeCuesta | Confusion);
    let concepts = |rows: &[(&str, Kind)]| -> (usize, usize) {
        // A duplicate: another entry of the same concept and kind.
        let dups = rows.len() - rows.iter().map(|(c, k)| (*c, *k)).collect::<HashSet<_>>().len();
        let by: HashMap<&str, Vec<Kind>> = rows.iter().fold(HashMap::new(), |mut m, (c, k)| {
            m.entry(*c).or_default().push(*k);
            m
        });
        let contra = by.values().filter(|ks| ks.iter().any(|k| positive(*k)) && ks.iter().any(|k| negative(*k))).count();
        (dups, contra)
    };

    // Before: one entry per (kind, normalized text), every status kept.
    let mut before: Vec<(&str, Kind)> = Vec::new();
    let mut seen: HashSet<(Kind, String)> = HashSet::new();
    for (c, k, title, ..) in script {
        if seen.insert((*k, normalize(title))) {
            before.push((c, *k));
        }
    }
    let (dup_before, contra_before) = concepts(&before);

    // After: through the store, then the daily hygiene.
    let (db, dir) = db();
    let mut counts = Counts::default();
    for (c, k, title, s, days, verified) in script {
        let mut n = Note::new(*k, title, title, &format!("{s}#{c}"), &format!("Sesión: {s}"), ago(*days));
        n.verified = *verified;
        counts.add(&db.note(n).unwrap());
    }
    db.hygiene(Utc::now()).unwrap();
    let live = db.list().unwrap();
    let after: Vec<(&str, Kind)> = live.iter().map(|o| (script.iter().find(|x| o.evidence.iter().any(|e| e.source.ends_with(&format!("#{}", x.0)))).unwrap().0, o.kind)).collect();
    let (dup_after, contra_after) = concepts(&after);
    let open = db.stats().unwrap().2;
    println!("scripted: {} entries; before: {} kept, {dup_before} duplicates, {contra_before} contradictions", script.len(), before.len());
    println!("after: {} live, {dup_after} duplicates, {contra_after} contradictions ({open} waiting for the model); {counts:?}", live.len());
    assert!(dup_after < dup_before && contra_after < contra_before);
    assert_eq!(open, 1, "límites: verified but older against newer: the model decides");
    std::fs::remove_dir_all(dir).ok();
}

/// Plan section 8: recall over past sessions, the old exact-word search against
/// FTS5 with the library's stemming, with plurals and paraphrases.
#[test]
fn measure_recall_on_past_sessions() {
    let sessions: &[(&str, &str, &[&str])] = &[
        ("geometría", "Vimos el triángulo equilátero, la fórmula de su altura y por qué sus ángulos miden 60 grados.", &["confundió la altura con el lado"]),
        ("derivadas", "Vimos la derivada como pendiente de la recta tangente y la regla de la cadena.", &["practicar la regla del producto"]),
        ("fotosíntesis", "Repasamos cómo las plantas producen oxígeno y glucosa con la luz del sol.", &[]),
        ("revolución de mayo", "Vimos las causas de la Revolución de Mayo de 1810 y el primer gobierno patrio.", &[]),
        ("límites", "Vimos qué es un límite y cómo se calcula factorizando.", &["las indeterminaciones cero sobre cero"]),
        ("probabilidad", "Vimos eventos independientes y la regla de Laplace con dados.", &[]),
    ];
    let questions: &[(&str, &str)] = &[
        ("triángulos equiláteros", "geometría"),
        ("rectas tangentes", "derivadas"),
        ("la regla del producto", "derivadas"),
        ("cómo calcular límites", "límites"),
        ("indeterminación", "límites"),
        ("probabilidades con un dado", "probabilidad"),
        ("independencia de los eventos", "probabilidad"),
        ("gobiernos patrios de 1810", "revolución de mayo"),
        // Paraphrases: other words for the same thing.
        ("qué producen las plantas con luz solar", "fotosíntesis"),
        ("las alturas de un triángulo", "geometría"),
    ];
    let (db, dir) = db();
    let mut old: Vec<crate::session::Session> = Vec::new();
    for (title, summary, struggled) in sessions {
        let m = SessionMemory { summary: summary.to_string(), pending: vec![], struggled: struggled.iter().map(|s| s.to_string()).collect(), messages: 6, at: ago(1) };
        let mut s = crate::session::Session::new_chat(title);
        s.memory = Some(m.clone());
        db.record_session(&s.id, title, &m).unwrap();
        old.push(s);
    }
    let (mut hit_old, mut hit_new) = (0, 0);
    for (q, want) in questions {
        let o = crate::memory::recall(&old, q, "otra");
        if o.first().is_some_and(|l| l.contains(&format!("«{want}»"))) {
            hit_old += 1;
        }
        if db.search_sessions(q, "otra", 3).unwrap().first().is_some_and(|r| r.title == *want) {
            hit_new += 1;
        }
    }
    println!("recall@1 over {} questions: exact words {hit_old}, FTS5 + stemming {hit_new}", questions.len());
    assert!(hit_new > hit_old);
    std::fs::remove_dir_all(dir).ok();
}
